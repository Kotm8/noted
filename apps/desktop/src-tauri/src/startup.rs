use crate::gateway::{failure, Gateway};
use axum::{
    body::Body,
    extract::State,
    http::{Response, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Arc};
use tauri_plugin_autostart::ManagerExt;

/// Passed by the Windows startup entry, so a launch at sign-in can be told
/// apart from one the user started.
pub const AUTOSTART_ARGUMENT: &str = "--autostart";

/// Whether Noted starts with Windows lives in the registry, owned by the
/// autostart plugin. Only the choices that entry can't hold are kept here.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub minimized: bool,
    pub asked: bool,
}

pub struct Startup(PathBuf);

impl Startup {
    pub fn new(directory: &std::path::Path) -> Self {
        Self(directory.join("startup.json"))
    }

    pub fn load(&self) -> Preferences {
        fs::read(&self.0)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default()
    }

    fn save(&self, preferences: &Preferences) -> std::io::Result<()> {
        fs::create_dir_all(self.0.parent().unwrap())?;
        let temporary = self.0.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec(preferences)?)?;
        fs::rename(temporary, &self.0)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    enabled: bool,
    minimized: bool,
    asked: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    enabled: Option<bool>,
    minimized: Option<bool>,
    asked: Option<bool>,
}

fn status(state: &Gateway) -> Response<Body> {
    let preferences = state.startup.load();
    Json(Status {
        enabled: state.app.autolaunch().is_enabled().unwrap_or(false),
        minimized: preferences.minimized,
        asked: preferences.asked,
    })
    .into_response()
}

pub async fn read(State(state): State<Arc<Gateway>>) -> Response<Body> {
    status(&state)
}

pub async fn change(
    State(state): State<Arc<Gateway>>,
    Json(change): Json<Change>,
) -> Response<Body> {
    let launcher = state.app.autolaunch();
    if let Some(enabled) = change
        .enabled
        .filter(|enabled| *enabled != launcher.is_enabled().unwrap_or(false))
    {
        let result = if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        };
        if result.is_err() {
            return failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Windows didn't accept the startup setting.",
            );
        }
    }
    let mut preferences = state.startup.load();
    preferences.minimized = change.minimized.unwrap_or(preferences.minimized);
    preferences.asked = change.asked.unwrap_or(preferences.asked);
    if state.startup.save(&preferences).is_err() {
        return failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save the startup setting.",
        );
    }
    status(&state)
}
