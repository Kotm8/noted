mod cleanup;
mod firebase;
pub mod models;
mod progress;
pub(crate) mod release;
pub(crate) mod ssh;
#[cfg(test)]
mod tests;
mod worker;

use crate::gateway::{failure, Gateway};
use axum::{
    body::Body,
    extract::State,
    http::{Response, StatusCode},
    response::IntoResponse,
    Json,
};
use models::{Host, InstallRequest, Job, Plan};
use serde::Deserialize;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

const PACKAGE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/installer.tar"));
const PREPARE: &str =
    include_str!("../../../../../updater/noted_updater/resources/prepare-desktop.sh");

pub struct Installer {
    job: Mutex<Job>,
    path: PathBuf,
}

impl Installer {
    pub fn new(path: PathBuf) -> Self {
        let mut job: Job = fs::read(&path)
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
        if job.status == "running" {
            job.status = "failed".into();
            job.detail = "Setup was interrupted. Retry with the same details and passwords.".into();
        }
        Self {
            job: Mutex::new(job),
            path,
        }
    }

    fn save(&self, job: &Job) -> Result<(), String> {
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec(job).unwrap())
            .and_then(|_| fs::rename(temporary, &self.path))
            .map_err(|_| "Could not save installation progress.".into())
    }

    fn update(&self, phase: &str, detail: &str, status: &str) {
        let mut job = self.job.lock().unwrap();
        job.phase = phase.into();
        job.detail = detail.into();
        job.status = status.into();
        let _ = self.save(&job);
    }
}

pub async fn status(State(state): State<Arc<Gateway>>) -> Json<Job> {
    Json(state.installer.job.lock().unwrap().clone())
}

pub async fn probe(Json(host): Json<Host>) -> Response<Body> {
    match ssh::Ssh::probe(&host).await {
        Ok(identity) => Json(identity).into_response(),
        Err(detail) => failure(StatusCode::BAD_GATEWAY, &detail),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseRequest {
    repository: String,
    commit: Option<String>,
}

pub async fn check_release(Json(input): Json<ReleaseRequest>) -> Response<Body> {
    match release::load(&input.repository, input.commit.as_deref()).await {
        Ok(release) => Json(release).into_response(),
        Err(detail) => failure(StatusCode::BAD_GATEWAY, &detail),
    }
}

pub async fn start(
    State(state): State<Arc<Gateway>>,
    Json(input): Json<InstallRequest>,
) -> Response<Body> {
    if let Err(detail) = input.validate() {
        return failure(StatusCode::BAD_REQUEST, &detail);
    }
    {
        let mut job = state.installer.job.lock().unwrap();
        if matches!(job.status.as_str(), "running" | "waiting_dns") {
            return failure(
                StatusCode::CONFLICT,
                "Finish the current installation before starting another.",
            );
        }
        *job = Job {
            status: "running".into(),
            phase: "release".into(),
            detail: "Verifying the selected release before connecting to your VPS.".into(),
            plan: Some(input.plan.clone()),
        };
        if let Err(detail) = state.installer.save(&job) {
            job.status = "failed".into();
            return failure(StatusCode::INTERNAL_SERVER_ERROR, &detail);
        }
    }
    let result = state.installer.job.lock().unwrap().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(detail) = worker::install(&state, input).await {
            let phase = state.installer.job.lock().unwrap().phase.clone();
            state.installer.update(&phase, &detail, "failed");
        }
    });
    (StatusCode::ACCEPTED, Json(result)).into_response()
}

pub async fn inspect_cleanup(
    State(state): State<Arc<Gateway>>,
    Json(request): Json<cleanup::CleanupRequest>,
) -> Response<Body> {
    let plan = {
        let job = state.installer.job.lock().unwrap();
        if !matches!(job.status.as_str(), "failed" | "waiting_dns") {
            return failure(StatusCode::CONFLICT, "Cleanup is available after a failed or unfinished setup.");
        }
        let Some(plan) = job.plan.clone() else {
            return failure(StatusCode::CONFLICT, "No server setup is available to clean up.");
        };
        plan
    };
    match cleanup::execute(&plan, &request, false).await {
        Ok(result) => Json(result).into_response(),
        Err(detail) => failure(StatusCode::BAD_GATEWAY, &detail),
    }
}

pub async fn remove_setup(
    State(state): State<Arc<Gateway>>,
    Json(request): Json<cleanup::CleanupRequest>,
) -> Response<Body> {
    if let Err(detail) = request.validate(true) {
        return failure(StatusCode::BAD_REQUEST, &detail);
    }
    let plan = {
        let mut job = state.installer.job.lock().unwrap();
        if !matches!(job.status.as_str(), "failed" | "waiting_dns") {
            return failure(StatusCode::CONFLICT, "Wait for setup to stop before cleaning the server.");
        }
        let Some(plan) = job.plan.clone() else {
            return failure(StatusCode::CONFLICT, "No server setup is available to clean up.");
        };
        job.status = "running".into();
        job.phase = "cleanup".into();
        job.detail = "Removing Noted and its data from this VPS.".into();
        if let Err(detail) = state.installer.save(&job) {
            job.status = "failed".into();
            return failure(StatusCode::INTERNAL_SERVER_ERROR, &detail);
        }
        plan
    };
    let result = state.installer.job.lock().unwrap().clone();
    tauri::async_runtime::spawn(async move {
        match cleanup::execute(&plan, &request, true).await {
            Ok(result) => {
                let retained = result["directoryRetained"] == true;
                let mut job = state.installer.job.lock().unwrap();
                *job = Job {
                    status: "cleaned".into(),
                    phase: if retained { "cleanup_retained" } else { "cleanup" }.into(),
                    detail: if retained {
                        "Noted was removed. Unrelated files remain in /opt/noted; move them before starting setup again."
                    } else { "Noted was removed. You can start setup again." }.into(),
                    plan: None,
                };
                if state.installer.save(&job).is_err() {
                    job.detail = "Noted was removed, but local setup progress could not be saved. Restart the app before setting up another server.".into();
                }
            }
            Err(detail) => state.installer.update("cleanup", &detail, "failed"),
        }
    });
    (StatusCode::ACCEPTED, Json(result)).into_response()
}

pub async fn verify(State(state): State<Arc<Gateway>>) -> Response<Body> {
    let plan: Plan = {
        let job = state.installer.job.lock().unwrap();
        if job.status != "waiting_dns" {
            return failure(StatusCode::CONFLICT, "Finish installing the server first.");
        }
        job.plan.clone().unwrap()
    };
    let result = worker::verify_connection(&state, &plan).await;
    match result {
        Ok(()) => {
            state.installer.update(
                "complete",
                "Your server is ready. Sign in with the owner account you created.",
                "complete",
            );
            Json(state.installer.job.lock().unwrap().clone()).into_response()
        }
        Err(detail) => failure(StatusCode::BAD_GATEWAY, &detail),
    }
}
