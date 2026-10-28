use crate::installer::release::{download, github_client, trusted};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::io::AsyncWriteExt;

const REPOSITORY: &str = "kotm8/noted";
const MAXIMUM_APK: u64 = 300 * 1024 * 1024;

pub struct Apk {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// Finds the phone or watch APK published with the release built from `commit`.
pub async fn find(commit: &str, watch: bool) -> Result<Apk, String> {
    if commit.len() != 40 || !commit.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("The server didn't report which release it runs.".into());
    }
    let client = github_client(Duration::from_secs(60))?;
    let release: Value = serde_json::from_slice(
        &download(
            &client,
            &format!("https://api.github.com/repos/{REPOSITORY}/releases/tags/main-{commit}"),
            false,
            1048576,
        )
        .await
        .map_err(|_| "Couldn't find the GitHub release for your server's version.")?,
    )
    .map_err(|_| "Invalid release response.")?;
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let suffix = if watch { "_wear.apk" } else { "_android.apk" };
    let asset = assets
        .iter()
        .find(|item| {
            item["name"]
                .as_str()
                .is_some_and(|name| name.starts_with("Noted_") && name.ends_with(suffix))
        })
        .ok_or(if watch {
            "This release has no watch app."
        } else {
            "This release has no phone app."
        })?;
    let name = asset["name"].as_str().unwrap();
    let version = name
        .trim_start_matches("Noted_")
        .trim_end_matches(suffix)
        .to_string();
    let url = asset["url"].as_str().unwrap_or_default();
    if !url.to_ascii_lowercase().starts_with(&format!(
        "https://api.github.com/repos/{REPOSITORY}/releases/assets/"
    )) {
        return Err("The release file belongs to another repository.".into());
    }
    let sums = assets
        .iter()
        .find(|item| item["name"] == "SHA256SUMS")
        .and_then(|item| item["url"].as_str())
        .ok_or("The release has no checksums.")?;
    let sums = String::from_utf8(download(&client, sums, true, 65536).await?)
        .map_err(|_| "Invalid release checksums.")?;
    let sha256 = sums
        .lines()
        .find_map(|line| {
            let (hash, file) = line.split_once("  ")?;
            (file == name).then(|| hash.to_string())
        })
        .ok_or("The release checksums don't cover this app.")?;
    Ok(Apk {
        version,
        url: url.to_string(),
        sha256,
        size: asset["size"].as_u64().unwrap_or(0),
    })
}

/// Streams the APK to `path`, reporting progress, and refuses it unless the checksum matches.
pub async fn fetch(apk: &Apk, path: &Path, progress: impl Fn(u8)) -> Result<(), String> {
    let address = url::Url::parse(&apk.url).map_err(|_| "Invalid release download address.")?;
    if !trusted(&address) {
        return Err("Untrusted release download address.".into());
    }
    let mut response = github_client(Duration::from_secs(600))?
        .get(address)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|_| "Couldn't download the app from GitHub. Check your connection.")?;
    if !response.status().is_success() {
        return Err("GitHub didn't provide the app download.".into());
    }
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|_| "Could not save the download.")?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The download was interrupted.")?
    {
        received += chunk.len() as u64;
        if received > MAXIMUM_APK {
            return Err("The app download is unexpectedly large.".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|_| "Could not save the download.")?;
        if apk.size > 0 {
            progress((received * 100 / apk.size).min(100) as u8);
        }
    }
    file.flush()
        .await
        .map_err(|_| "Could not save the download.")?;
    if format!("{:x}", hasher.finalize()) != apk.sha256.to_ascii_lowercase() {
        return Err(
            "The download doesn't match the release checksum, so it wasn't installed.".into(),
        );
    }
    Ok(())
}
