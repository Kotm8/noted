mod release;
mod status;

#[cfg(test)]
mod tests;

use crate::gateway::{failure, Gateway};
use axum::{body::Body, extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex as AsyncMutex;

pub use status::{Phase, Status};

struct Download {
    update: Update,
    bytes: Vec<u8>,
}

pub struct ClientUpdates {
    status: Mutex<Status>,
    candidate: Mutex<Option<Update>>,
    download: Mutex<Option<Download>>,
    operation: Arc<AsyncMutex<()>>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Check,
    Download,
    Install,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    action: Action,
    version: Option<String>,
}

impl ClientUpdates {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            status: Mutex::new(Status::default()),
            candidate: Mutex::new(None),
            download: Mutex::new(None),
            operation: Arc::new(AsyncMutex::new(())),
        })
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn schedule(self: &Arc<Self>, app: AppHandle) {
        if !cfg!(windows) || cfg!(debug_assertions) {
            return;
        }
        let updates = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            loop {
                let _ = updates.start(app.clone(), Action::Check, None);
                // Noted can stay open for days when it starts with Windows.
                tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
            }
        });
    }

    fn start(
        self: &Arc<Self>,
        app: AppHandle,
        action: Action,
        version: Option<String>,
    ) -> Result<Status, String> {
        if !cfg!(windows) {
            return Err("Automatic desktop updates are available on Windows.".into());
        }
        let guard = self
            .operation
            .clone()
            .try_lock_owned()
            .map_err(|_| "An update operation is already running.")?;
        {
            let mut status = self.status.lock().unwrap();
            if !matches!(action, Action::Check)
                && version.as_ref() != status.latest_version.as_ref()
            {
                return Err("The available update changed. Check for updates again.".into());
            }
            if status.phase == Phase::Ready && !matches!(action, Action::Install) {
                return Err("An update is downloaded and ready to install.".into());
            }
            if matches!(action, Action::Download) && self.candidate.lock().unwrap().is_none() {
                return Err("Check for updates before downloading.".into());
            }
            if matches!(action, Action::Install)
                && (status.phase != Phase::Ready || self.download.lock().unwrap().is_none())
            {
                return Err("Download and verify the update before installing.".into());
            }
            status.error = None;
            status.phase = match action {
                Action::Check => Phase::Checking,
                Action::Download => Phase::Downloading,
                Action::Install => Phase::Installing,
            };
        }
        let updates = self.clone();
        tauri::async_runtime::spawn(async move {
            let _guard = guard;
            let result = match action {
                Action::Check => updates.check(&app).await,
                Action::Download => updates.download().await,
                Action::Install => updates.install().await,
            };
            if let Err(error) = result {
                let mut status = updates.status.lock().unwrap();
                status.phase = Phase::Error;
                status.error = Some(error);
            }
        });
        Ok(self.status())
    }

    async fn check(&self, app: &AppHandle) -> Result<(), String> {
        let update = app
            .updater_builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Could not initialize desktop updates: {e}"))?
            .check()
            .await
            .map_err(|_| {
                "Could not check for desktop updates. Check your connection and try again."
            })?;
        if let Some(update) = &update {
            release::validate_download(&update.download_url, &update.version)?;
        }
        let mut status = self.status.lock().unwrap();
        status.checked_at = Some(crate::session_vault::now());
        status.latest_version = update.as_ref().map(|u| u.version.clone());
        status.notes = update.as_ref().and_then(|u| u.body.clone());
        status.phase = if update.is_some() {
            Phase::Available
        } else {
            Phase::Idle
        };
        status.downloaded_bytes = 0;
        status.total_bytes = None;
        *self.candidate.lock().unwrap() = update;
        Ok(())
    }

    async fn download(&self) -> Result<(), String> {
        let update = self
            .candidate
            .lock()
            .unwrap()
            .clone()
            .ok_or("Check for updates before downloading.")?;
        {
            let mut status = self.status.lock().unwrap();
            status.downloaded_bytes = 0;
            status.total_bytes = None;
        }
        let bytes = update.download(|count, total| {
            let mut status = self.status.lock().unwrap();
            status.downloaded_bytes = status.downloaded_bytes.saturating_add(count as u64);
            status.total_bytes = total;
        }, || {}).await.map_err(|_| "The update could not be downloaded or its signature did not verify. Nothing was installed.")?;
        *self.download.lock().unwrap() = Some(Download { update, bytes });
        self.status.lock().unwrap().phase = Phase::Ready;
        Ok(())
    }

    async fn install(&self) -> Result<(), String> {
        let download = self
            .download
            .lock()
            .unwrap()
            .take()
            .ok_or("Download the update first.")?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        tokio::task::spawn_blocking(move || download.update.install(download.bytes))
            .await
            .map_err(|_| "Could not start the desktop installer.")?
            .map_err(|_| {
                "The desktop installer could not start. Download the update and try again.".into()
            })
    }
}

pub async fn read(State(state): State<Arc<Gateway>>) -> Json<Status> {
    Json(state.client_updates.status())
}

pub async fn act(
    State(state): State<Arc<Gateway>>,
    Json(request): Json<Request>,
) -> axum::http::Response<Body> {
    match state
        .client_updates
        .start(state.app.clone(), request.action, request.version)
    {
        Ok(status) => (StatusCode::ACCEPTED, Json(status)).into_response(),
        Err(error) => failure(StatusCode::CONFLICT, &error),
    }
}
