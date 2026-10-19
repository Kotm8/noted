use regex::Regex;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Host {
    pub ip: IpAddr,
    pub port: u16,
}

impl Host {
    pub fn validate(&self) -> Result<(), String> {
        if self.port == 0 || self.ip.is_unspecified() || self.ip.is_multicast() {
            return Err("Enter a server IP and an SSH port between 1 and 65535.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub host: Host,
    pub host_key: String,
    pub server_name: String,
    pub domain: String,
    pub username: String,
    pub repository: String,
    pub release_commit: String,
    pub manifest_sha256: String,
}

impl Plan {
    pub fn validate(&self) -> Result<(), String> {
        self.host.validate()?;
        if self.host_key.len() > 4096
            || !self.host_key.starts_with("ssh-") && !self.host_key.starts_with("ecdsa-")
        {
            return Err("Verify this server's SSH host key first.".into());
        }
        if self.domain.len() > 253
            || !matches(
                r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
                &self.domain,
            )
        {
            return Err("Enter a domain without a path or port.".into());
        }
        if !(1..=80).contains(&self.server_name.chars().count())
            || self.server_name.chars().any(char::is_control)
        {
            return Err("Use a server name of 1 to 80 characters.".into());
        }
        if !(1..=64).contains(&self.username.chars().count())
            || !matches(r"^[\p{L}\p{N}_. -]+$", &self.username)
        {
            return Err("Enter a valid owner username.".into());
        }
        repository(&self.repository)?;
        if !matches(r"^[a-f0-9]{40}$", &self.release_commit)
            || !matches(r"^[a-f0-9]{64}$", &self.manifest_sha256)
        {
            return Err("Choose a published Noted release first.".into());
        }
        Ok(())
    }
}

pub fn matches(pattern: &str, value: &str) -> bool {
    Regex::new(pattern).unwrap().is_match(value)
}

pub fn repository(value: &str) -> Result<(), String> {
    if value.len() > 200 || !matches(r"^[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*$", value) {
        return Err("Use a release repository in owner/name format.".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallRequest {
    pub plan: Plan,
    pub ssh_user: String,
    pub ssh_password: String,
    pub password: String,
    #[serde(default)]
    pub android_notifications: Option<super::firebase::FirebaseSetup>,
}

impl InstallRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.plan.validate()?;
        if let Some(firebase) = &self.android_notifications {
            firebase.validate()?;
        }
        if self.ssh_user != "root" {
            return Err("This installer currently requires the root SSH account.".into());
        }
        if self.ssh_password.is_empty()
            || self.ssh_password.len() > 4096
            || !(12..=256).contains(&self.password.chars().count())
        {
            return Err(
                "Check the SSH password and use an owner password of 12 to 256 characters.".into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub status: String,
    pub phase: String,
    pub detail: String,
    pub plan: Option<Plan>,
}
