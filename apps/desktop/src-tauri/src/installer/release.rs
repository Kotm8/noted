use super::models::{matches, repository};
use reqwest::{redirect::Policy, Client};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Read, time::Duration};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub commit: String,
    pub manifest_sha256: String,
    #[serde(skip)]
    pub manifest: Value,
    #[serde(skip)]
    pub deployment: Vec<u8>,
}

pub fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn trusted(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.host_str().is_some_and(|host| {
            matches!(host, "api.github.com" | "github.com")
                || host.ends_with(".githubusercontent.com")
        })
}

async fn download(
    client: &Client,
    url: &str,
    binary: bool,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let address = url::Url::parse(url).map_err(|_| "Invalid release download address.")?;
    if !trusted(&address) {
        return Err("Untrusted release download address.".into());
    }
    let mut response = client
        .get(address)
        .header(
            "Accept",
            if binary {
                "application/octet-stream"
            } else {
                "application/vnd.github+json"
            },
        )
        .send()
        .await
        .map_err(|_| "Could not download the release. Check your connection.")?;
    if !response.status().is_success() {
        return Err("No accessible release found. Publish the Noted release files and public Docker images first.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The release download was interrupted.")?
    {
        if bytes.len() + chunk.len() > maximum {
            return Err("Release download exceeds its size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn validate_manifest(data: &Value, repo: &str) -> Result<(), String> {
    repository(repo)?;
    if data["format"] != 1
        || data["channel"] != "main"
        || data["repository"] != repo
        || data["api_version"] != 1
        || data["configuration_version"] != 1
        || !data["minimum_updater_version"]
            .as_u64()
            .is_some_and(|n| (1..=2).contains(&n))
    {
        return Err("This release requires a different Noted installer.".into());
    }
    if !data["commit"]
        .as_str()
        .is_some_and(|s| matches(r"^[a-f0-9]{40}$", s))
        || !data["version"]
            .as_str()
            .is_some_and(|s| matches(r"^[0-9A-Za-z.+-]{1,100}$", s))
        || !data["schema_revision"]
            .as_str()
            .is_some_and(|s| matches(r"^[a-z0-9_]{1,32}$", s))
        || !data["sequence"]
            .as_u64()
            .is_some_and(|n| (1..=9007199254740991).contains(&n))
        || !data["supported_source_schemas"]
            .as_array()
            .is_some_and(|items| {
                !items.is_empty()
                    && items.len() <= 100
                    && items
                        .iter()
                        .all(|s| s.as_str().is_some_and(|s| matches(r"^[a-z0-9_]{1,32}$", s)))
            })
    {
        return Err("Invalid release metadata.".into());
    }
    for service in ["backend", "web"] {
        let image = data[format!("{service}_image")]
            .as_str()
            .unwrap_or_default();
        let prefix = format!("ghcr.io/{repo}-{service}@sha256:");
        if !image
            .strip_prefix(&prefix)
            .is_some_and(|s| matches(r"^[a-f0-9]{64}$", s))
        {
            return Err("The release must use exact image digests from its own repository.".into());
        }
    }
    if !data["bundle_sha256"]
        .as_str()
        .is_some_and(|s| matches(r"^[a-f0-9]{64}$", s))
    {
        return Err("The release has no valid deployment checksum.".into());
    }
    Ok(())
}

pub fn deployment(raw: &[u8], expected: &str) -> Result<Vec<u8>, String> {
    if checksum(raw) != expected {
        return Err("The deployment checksum does not match.".into());
    }
    let mut unpacked = Vec::new();
    flate2::read::GzDecoder::new(raw)
        .take(3145729)
        .read_to_end(&mut unpacked)
        .map_err(|_| "Invalid deployment archive.")?;
    if unpacked.len() > 3145728 {
        return Err("The expanded deployment archive is too large.".into());
    }
    let mut archive = tar::Archive::new(unpacked.as_slice());
    let mut names = HashSet::new();
    for entry in archive
        .entries()
        .map_err(|_| "Invalid deployment archive.")?
    {
        let entry = entry.map_err(|_| "Invalid deployment entry.")?;
        let name = entry
            .path()
            .map_err(|_| "Invalid deployment filename.")?
            .to_string_lossy()
            .into_owned();
        if !matches!(
            name.as_str(),
            "compose.production.yaml" | "Caddyfile.production"
        ) || !entry.header().entry_type().is_file()
            || entry.size() > 1048576
            || !names.insert(name)
        {
            return Err("Unsafe deployment archive.".into());
        }
    }
    if names.len() != 2 {
        return Err("Deployment files are missing.".into());
    }
    Ok(unpacked)
}

pub async fn load(repo: &str, commit: Option<&str>) -> Result<Release, String> {
    repository(repo)?;
    let suffix = match commit {
        Some(commit) if matches(r"^[a-f0-9]{40}$", commit) => format!("tags/main-{commit}"),
        Some(_) => return Err("Invalid release commit.".into()),
        None => "latest".into(),
    };
    let client = Client::builder()
        .user_agent("Noted-desktop-installer")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && trusted(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "Could not initialize release downloads.")?;
    let data: Value = serde_json::from_slice(
        &download(
            &client,
            &format!("https://api.github.com/repos/{repo}/releases/{suffix}"),
            false,
            1048576,
        )
        .await?,
    )
    .map_err(|_| "Invalid release response.")?;
    if data["draft"] != false || data["prerelease"] != false {
        return Err("Choose a published stable release.".into());
    }
    let asset = |name: &str| -> Result<String, String> {
        let url = data["assets"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["name"] == name))
            .and_then(|item| item["url"].as_str())
            .ok_or("Required release files are missing.")?;
        if !url.to_ascii_lowercase().starts_with(&format!(
            "https://api.github.com/repos/{repo}/releases/assets/"
        )) {
            return Err("The release asset belongs to another repository.".into());
        }
        Ok(url.to_owned())
    };
    let raw = download(&client, &asset("noted-release.json")?, true, 65536).await?;
    let manifest: Value = serde_json::from_slice(&raw).map_err(|_| "Invalid release manifest.")?;
    validate_manifest(&manifest, repo)?;
    let commit = manifest["commit"].as_str().unwrap().to_owned();
    if data["tag_name"] != format!("main-{commit}") {
        return Err("The release tag and manifest do not match.".into());
    }
    let bundle = download(&client, &asset("noted-deploy.tar.gz")?, true, 2097152).await?;
    let deployment = deployment(&bundle, manifest["bundle_sha256"].as_str().unwrap())?;
    Ok(Release {
        version: manifest["version"].as_str().unwrap().to_owned(),
        commit,
        manifest_sha256: checksum(&raw),
        manifest,
        deployment,
    })
}
