use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub supported: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
    pub checked_at: Option<u64>,
    pub phase: Phase,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            supported: cfg!(windows),
            current_version: env!("CARGO_PKG_VERSION").into(),
            latest_version: None,
            notes: None,
            checked_at: None,
            phase: Phase::Idle,
            downloaded_bytes: 0,
            total_bytes: None,
            error: None,
        }
    }
}
