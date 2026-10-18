use super::{models::Plan, ssh::Ssh};
use serde::{Deserialize, Serialize};

const SOURCE: &str = include_str!("../../../../../updater/noted_updater/cleanup.py");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupRequest {
    pub ssh_password: String,
    pub confirmation: Option<String>,
    pub snapshot: Option<String>,
}

impl CleanupRequest {
    pub fn validate(&self, remove: bool) -> Result<(), String> {
        if self.ssh_password.is_empty() || self.ssh_password.len() > 4096 {
            return Err("Enter the root SSH password for this VPS.".into());
        }
        if remove
            && (self.confirmation.as_deref() != Some("I LOVE VERITY")
                || !self
                    .snapshot
                    .as_ref()
                    .is_some_and(|value| super::models::matches(r"^[a-f0-9]{64}$", value)))
        {
            return Err("Inspect the installation and type I LOVE VERITY exactly.".into());
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub present: bool,
    pub server_name: String,
    pub domain: String,
    pub snapshot: String,
    pub container_count: u32,
    pub volume_count: u32,
}

pub async fn execute(
    plan: &Plan,
    request: &CleanupRequest,
    remove: bool,
) -> Result<serde_json::Value, String> {
    request.validate(remove)?;
    let ssh = Ssh::login(
        &plan.host,
        plan.host_key.clone(),
        "root",
        &request.ssh_password,
    )
    .await?;
    let data = serde_json::to_vec(&serde_json::json!({
        "action": if remove { "remove" } else { "inspect" },
        "repository": plan.repository,
        "confirmation": request.confirmation,
        "snapshot": request.snapshot,
    }))
    .unwrap();
    let command = format!(
        "PYTHONDONTWRITEBYTECODE=1 python3 -c '{}'",
        SOURCE.replace('\'', "'\"'\"'")
    );
    let mut output = Vec::new();
    let code = ssh
        .execute(&command, &data, 600, |chunk| {
            if output.len() + chunk.len() <= 16384 {
                output.extend_from_slice(chunk);
            }
        })
        .await?;
    let result: serde_json::Value = serde_json::from_slice(&output)
        .map_err(|_| "Could not read the cleanup result. Inspect the VPS before retrying.")?;
    if code != 0 {
        return Err(result["error"]
            .as_str()
            .filter(|value| value.len() <= 500)
            .unwrap_or("Noted cleanup stopped. Inspect the VPS before retrying.")
            .to_owned());
    }
    if remove {
        if result["removed"] != true {
            return Err("The VPS did not confirm cleanup.".into());
        }
    } else {
        let inspection: Inspection = serde_json::from_value(result.clone())
            .map_err(|_| "The VPS returned an invalid cleanup inspection.")?;
        if !super::models::matches(r"^[a-f0-9]{64}$", &inspection.snapshot)
            || inspection.server_name.len() > 320
            || inspection.domain.len() > 253
        {
            return Err("The VPS returned an invalid cleanup inspection.".into());
        }
    }
    Ok(result)
}
