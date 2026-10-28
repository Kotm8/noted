mod adb;
mod release;
mod tool;

use crate::gateway::{failure, token, Gateway};
use adb::{is_wireless, Adb, Listed};
use axum::{
    body::Body,
    extract::State,
    http::{Response, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

/// A phone or watch this PC has connected to, so it can be found again later.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    id: String,
    watch: bool,
    name: String,
    /// USB serial; absent for Wi-Fi devices.
    serial: Option<String>,
    /// Last Wi-Fi address and mDNS name; the address changes, the name doesn't.
    host: Option<String>,
    instance: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceView {
    id: String,
    kind: &'static str,
    name: String,
    connection: &'static str,
    connected: bool,
    installed: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Overview {
    tool: tool::Tool,
    server_version: Option<String>,
    devices: Vec<DeviceView>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    device_id: String,
    /// "idle", "running", "done" or "failed".
    status: String,
    /// "connect", "download", "install" or "cleanup".
    stage: String,
    progress: u8,
    detail: String,
    /// The device couldn't be reached; the app offers retrying instead of a plain error.
    unreachable: bool,
    version: String,
}

pub struct Devices {
    store: PathBuf,
    tools: PathBuf,
    saved: tokio::sync::Mutex<Vec<Saved>>,
    job: Mutex<Job>,
}

impl Devices {
    pub fn new(directory: &std::path::Path) -> Self {
        let store = directory.join("devices.json");
        let saved = fs::read(&store)
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
        Self {
            store,
            tools: directory.join("tools"),
            saved: tokio::sync::Mutex::new(saved),
            job: Mutex::new(Job {
                status: "idle".into(),
                ..Job::default()
            }),
        }
    }

    fn adb(&self) -> Result<Adb, String> {
        tool::locate(&self.tools)
            .path
            .map(|path| Adb(path.into()))
            .ok_or_else(|| "Download Android's install tool first.".into())
    }

    fn persist(&self, saved: &[Saved]) {
        let _ = fs::write(&self.store, serde_json::to_vec(saved).unwrap());
    }

    /// Keeps one phone and one watch: a newly connected device replaces the previous one of its kind.
    async fn remember(&self, device: Saved) {
        let mut saved = self.saved.lock().await;
        saved.retain(|item| item.watch != device.watch);
        saved.push(device);
        self.persist(&saved);
    }

    fn update(&self, change: impl FnOnce(&mut Job)) {
        change(&mut self.job.lock().unwrap());
    }
}

fn mdns_serial(instance: &str) -> String {
    format!("{instance}._adb-tls-connect._tcp")
}

/// The serial adb currently uses for a saved device, if it's connected right now.
fn resolve(device: &Saved, listed: &[Listed]) -> Option<String> {
    listed
        .iter()
        .filter(|item| item.state == "device")
        .find(
            |item| match (&device.serial, &device.host, &device.instance) {
                (Some(serial), _, _) => &item.serial == serial,
                (None, host, instance) => {
                    host.as_ref()
                        .is_some_and(|host| item.serial.starts_with(&format!("{host}:")))
                        || instance
                            .as_ref()
                            .is_some_and(|instance| item.serial == mdns_serial(instance))
                }
            },
        )
        .map(|item| item.serial.clone())
}

/// Finds a saved device again, reconnecting over Wi-Fi when needed.
async fn reach(devices: &Devices, adb: &Adb, id: &str) -> Result<(Saved, String), String> {
    let device = devices
        .saved
        .lock()
        .await
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or("This device was forgotten. Connect it again.")?;
    if let Some(serial) = resolve(&device, &adb.devices().await?) {
        return Ok((device, serial));
    }
    if device.serial.is_some() {
        return Err("The phone isn't plugged in, or USB debugging is off.".into());
    }
    let (instance, address) = adb
        .discover(device.host.as_deref(), device.instance.as_deref())
        .await
        .ok_or("No answer from the device on this network.")?;
    adb.connect(&address).await?;
    let mut updated = device.clone();
    updated.host = address.rsplit_once(':').map(|(host, _)| host.to_string());
    updated.instance = Some(instance);
    devices.remember(updated.clone()).await;
    Ok((updated, address))
}

async fn view(adb: &Adb, device: &Saved, serial: Option<&str>) -> DeviceView {
    let installed = match serial {
        Some(serial) => adb
            .describe(serial)
            .await
            .ok()
            .and_then(|info| info.installed),
        None => None,
    };
    DeviceView {
        id: device.id.clone(),
        kind: if device.watch { "watch" } else { "phone" },
        name: device.name.clone(),
        connection: if device.serial.is_some() {
            "usb"
        } else {
            "wifi"
        },
        connected: serial.is_some(),
        installed,
    }
}

async fn server_version(state: &Gateway) -> Result<(String, String), String> {
    let connection = state
        .connection
        .read()
        .await
        .clone()
        .ok_or("Connect to your Noted server first.")?;
    let data: serde_json::Value = connection
        .client
        .get(connection.url.join("api/v1/version").unwrap())
        .send()
        .await
        .map_err(|_| "Couldn't reach your Noted server.")?
        .json()
        .await
        .map_err(|_| "Couldn't read your server's version.")?;
    Ok((
        data["version"].as_str().unwrap_or_default().to_string(),
        data["build_commit"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    ))
}

pub async fn overview(State(state): State<Arc<Gateway>>) -> Json<serde_json::Value> {
    let devices = &state.devices;
    let tool = tool::locate(&devices.tools);
    let saved = devices.saved.lock().await.clone();
    let mut views = Vec::new();
    if let Ok(adb) = devices.adb() {
        let listed = adb.devices().await.unwrap_or_default();
        for device in &saved {
            views.push(view(&adb, device, resolve(device, &listed).as_deref()).await);
        }
    }
    Json(serde_json::json!(Overview {
        tool,
        server_version: server_version(&state)
            .await
            .ok()
            .map(|(version, _)| version),
        devices: views,
    }))
}

pub async fn download_tool(State(state): State<Arc<Gateway>>) -> Response<Body> {
    match tool::download(&state.devices.tools).await {
        Ok(tool) => Json(tool).into_response(),
        Err(detail) => failure(StatusCode::BAD_GATEWAY, &detail),
    }
}

async fn describe_and_save(
    devices: &Devices,
    adb: &Adb,
    serial: &str,
    wifi: Option<(String, String)>,
) -> Response<Body> {
    let description = match adb.describe(serial).await {
        Ok(description) => description,
        Err(_) => {
            return failure(
                StatusCode::BAD_GATEWAY,
                "Connected, but the device didn't answer. Unlock it and try again.",
            )
        }
    };
    let device = Saved {
        id: token()[..16].to_string(),
        watch: description.watch,
        name: description.name,
        serial: wifi.is_none().then(|| serial.to_string()),
        host: wifi.as_ref().map(|(host, _)| host.clone()),
        instance: wifi.map(|(_, instance)| instance),
    };
    devices.remember(device.clone()).await;
    Json(view(adb, &device, Some(serial)).await).into_response()
}

/// Polled by the USB dialog while it waits for a phone to be plugged in and allowed.
pub async fn detect_usb(State(state): State<Arc<Gateway>>) -> Response<Body> {
    let devices = &state.devices;
    let adb = match devices.adb() {
        Ok(adb) => adb,
        Err(detail) => return failure(StatusCode::CONFLICT, &detail),
    };
    let listed = adb.devices().await.unwrap_or_default();
    let usb: Vec<&Listed> = listed
        .iter()
        .filter(|item| !is_wireless(&item.serial))
        .collect();
    match usb.iter().find(|item| item.state == "device") {
        Some(found) => describe_and_save(devices, &adb, &found.serial, None).await,
        None if usb.iter().any(|item| item.state == "unauthorized") => {
            Json(serde_json::json!({"waiting": "unauthorized"})).into_response()
        }
        None => Json(serde_json::json!({"waiting": "device"})).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pairing {
    address: String,
    code: String,
}

pub async fn pair(State(state): State<Arc<Gateway>>, Json(input): Json<Pairing>) -> Response<Body> {
    let devices = &state.devices;
    let adb = match devices.adb() {
        Ok(adb) => adb,
        Err(detail) => return failure(StatusCode::CONFLICT, &detail),
    };
    let address = input.address.trim();
    let Some((host, port)) = address.rsplit_once(':') else {
        return failure(
            StatusCode::BAD_REQUEST,
            "Enter the address and port, like 192.168.1.23:37199.",
        );
    };
    if host.parse::<std::net::IpAddr>().is_err() || port.parse::<u16>().is_err() {
        return failure(
            StatusCode::BAD_REQUEST,
            "Enter the address and port, like 192.168.1.23:37199.",
        );
    }
    let code = input.code.trim();
    if code.len() != 6 || !code.bytes().all(|c| c.is_ascii_digit()) {
        return failure(StatusCode::BAD_REQUEST, "The pairing code has 6 digits.");
    }
    if let Err(detail) = adb.pair(address, code).await {
        return failure(StatusCode::BAD_GATEWAY, &detail);
    }
    // After pairing, the device announces its connection port shortly; give it a few seconds.
    for _ in 0..6 {
        if let Some((instance, connect)) = adb.discover(Some(host), None).await {
            if adb.connect(&connect).await.is_ok() {
                return describe_and_save(
                    devices,
                    &adb,
                    &connect,
                    Some((host.to_string(), instance)),
                )
                .await;
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    failure(
        StatusCode::BAD_GATEWAY,
        "Paired, but couldn't connect. Keep Wireless debugging open on the device and try again.",
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    id: String,
    /// The release to install from; defaults to the connected server's.
    commit: Option<String>,
}

pub async fn reconnect(
    State(state): State<Arc<Gateway>>,
    Json(input): Json<Target>,
) -> Response<Body> {
    let devices = &state.devices;
    let adb = match devices.adb() {
        Ok(adb) => adb,
        Err(detail) => return failure(StatusCode::CONFLICT, &detail),
    };
    match reach(devices, &adb, &input.id).await {
        Ok((device, serial)) => Json(view(&adb, &device, Some(&serial)).await).into_response(),
        Err(detail) => failure(StatusCode::CONFLICT, &detail),
    }
}

pub async fn forget(State(state): State<Arc<Gateway>>, Json(input): Json<Target>) -> StatusCode {
    let devices = &state.devices;
    let mut saved = devices.saved.lock().await;
    if let (Some(device), Ok(adb)) = (saved.iter().find(|item| item.id == input.id), devices.adb())
    {
        if let Some(host) = &device.host {
            for item in adb.devices().await.unwrap_or_default() {
                if item.serial.starts_with(&format!("{host}:")) {
                    adb.disconnect(&item.serial).await;
                }
            }
        }
    }
    saved.retain(|item| item.id != input.id);
    devices.persist(&saved);
    StatusCode::NO_CONTENT
}

pub async fn job(State(state): State<Arc<Gateway>>) -> Json<Job> {
    Json(state.devices.job.lock().unwrap().clone())
}

pub async fn install(
    State(state): State<Arc<Gateway>>,
    Json(input): Json<Target>,
) -> Response<Body> {
    {
        let mut job = state.devices.job.lock().unwrap();
        if job.status == "running" {
            return failure(StatusCode::CONFLICT, "Another install is still running.");
        }
        *job = Job {
            device_id: input.id.clone(),
            status: "running".into(),
            stage: "connect".into(),
            ..Job::default()
        };
    }
    let worker = state.clone();
    tokio::spawn(async move {
        let devices = &worker.devices;
        let result = run_install(&worker, &input).await;
        devices.update(|job| match result {
            Ok(version) => {
                job.status = "done".into();
                job.version = version;
            }
            Err((detail, unreachable)) => {
                job.status = "failed".into();
                job.detail = detail;
                job.unreachable = unreachable;
            }
        });
    });
    StatusCode::NO_CONTENT.into_response()
}

/// Connects, downloads the matching APK into a temporary folder, installs it, and
/// always removes the folder afterwards.
async fn run_install(state: &Gateway, input: &Target) -> Result<String, (String, bool)> {
    let devices = &state.devices;
    let adb = devices.adb().map_err(|detail| (detail, false))?;
    let (device, serial) = reach(devices, &adb, &input.id)
        .await
        .map_err(|detail| (detail, true))?;
    let commit = match &input.commit {
        Some(commit) => commit.clone(),
        None => {
            server_version(state)
                .await
                .map_err(|detail| (detail, false))?
                .1
        }
    };
    devices.update(|job| job.stage = "download".into());
    let apk = release::find(&commit, device.watch)
        .await
        .map_err(|detail| (detail, false))?;
    devices.update(|job| job.version = apk.version.clone());
    let folder = std::env::temp_dir().join(format!("noted-install-{}", &token()[..12]));
    let outcome = async {
        fs::create_dir_all(&folder)
            .map_err(|_| "Could not create a temporary folder.".to_string())?;
        let path = folder.join(if device.watch {
            "noted-watch.apk"
        } else {
            "noted-phone.apk"
        });
        release::fetch(&apk, &path, |percent| {
            devices.update(|job| job.progress = percent)
        })
        .await?;
        devices.update(|job| job.stage = "install".into());
        adb.install(&serial, &path.display().to_string()).await
    }
    .await;
    devices.update(|job| job.stage = "cleanup".into());
    let _ = fs::remove_dir_all(&folder);
    outcome
        .map(|_| apk.version)
        .map_err(|detail| (detail, false))
}
