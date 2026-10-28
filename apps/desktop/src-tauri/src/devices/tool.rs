use reqwest::{redirect::Policy, Client};
use serde::Serialize;
use std::{
    env, fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    time::Duration,
};

const EXECUTABLE: &str = if cfg!(windows) { "adb.exe" } else { "adb" };
/// Only what `adb` needs to run; the rest of platform-tools is left out.
const KEEP: [&str; 5] = [
    EXECUTABLE,
    "AdbWinApi.dll",
    "AdbWinUsbApi.dll",
    "libwinpthread-1.dll",
    "NOTICE.txt",
];
const MAXIMUM_ARCHIVE: usize = 40 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub ready: bool,
    /// "downloaded" when Noted fetched it, "existing" for an Android SDK already on this PC.
    pub source: Option<&'static str>,
    pub path: Option<String>,
}

fn sdk_locations() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .iter()
        .filter_map(|name| env::var_os(name).map(PathBuf::from))
        .collect();
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Android/Sdk"));
    }
    if cfg!(windows) {
        roots.push(PathBuf::from("C:/Program Files (x86)/Android/android-sdk"));
    }
    let mut candidates: Vec<PathBuf> = roots
        .into_iter()
        .map(|root| root.join("platform-tools").join(EXECUTABLE))
        .collect();
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|dir| dir.join(EXECUTABLE)));
    }
    candidates
}

/// Prefers the copy Noted downloaded, then any Android SDK or `adb` on PATH.
pub fn locate(tools: &Path) -> Tool {
    let downloaded = tools.join("platform-tools").join(EXECUTABLE);
    if downloaded.is_file() {
        return Tool {
            ready: true,
            source: Some("downloaded"),
            path: Some(downloaded.display().to_string()),
        };
    }
    match sdk_locations().into_iter().find(|path| path.is_file()) {
        Some(path) => Tool {
            ready: true,
            source: Some("existing"),
            path: Some(path.display().to_string()),
        },
        None => Tool {
            ready: false,
            source: None,
            path: None,
        },
    }
}

fn archive_url() -> Result<&'static str, String> {
    match env::consts::OS {
        "windows" => {
            Ok("https://dl.google.com/android/repository/platform-tools-latest-windows.zip")
        }
        "linux" => Ok("https://dl.google.com/android/repository/platform-tools-latest-linux.zip"),
        "macos" => Ok("https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"),
        _ => Err("Android's install tool isn't available for this system.".into()),
    }
}

/// Downloads Google's platform-tools straight from Google and keeps only `adb`,
/// so Noted never redistributes it.
pub async fn download(tools: &Path) -> Result<Tool, String> {
    let client = Client::builder()
        .user_agent("Noted-desktop")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .redirect(Policy::custom(|attempt| {
            if attempt.url().host_str() == Some("dl.google.com") && attempt.previous().len() < 3 {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "Could not start the download.")?;
    let mut response = client.get(archive_url()?).send().await.map_err(|_| {
        "Couldn't reach Google to download the install tool. Check your connection."
    })?;
    if !response.status().is_success() {
        return Err("Google's download of the install tool isn't available right now.".into());
    }
    let mut archive = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The install tool download was interrupted.")?
    {
        if archive.len() + chunk.len() > MAXIMUM_ARCHIVE {
            return Err("The install tool download is unexpectedly large.".into());
        }
        archive.extend_from_slice(&chunk);
    }
    let staging = tools.join("platform-tools.partial");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|_| "Could not save the install tool.")?;
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|_| "The install tool download is damaged.")?;
    for name in KEEP {
        let Ok(mut entry) = zip.by_name(&format!("platform-tools/{name}")) else {
            continue;
        };
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|_| "The install tool download is damaged.")?;
        fs::write(staging.join(name), bytes).map_err(|_| "Could not save the install tool.")?;
    }
    let executable = staging.join(EXECUTABLE);
    if !executable.is_file() {
        return Err("The download didn't contain Android's install tool.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&executable, fs::Permissions::from_mode(0o755));
    }
    let target = tools.join("platform-tools");
    let _ = fs::remove_dir_all(&target);
    fs::rename(&staging, &target).map_err(|_| "Could not save the install tool.")?;
    Ok(locate(tools))
}
