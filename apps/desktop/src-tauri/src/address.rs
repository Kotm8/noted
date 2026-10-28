use crate::{
    gateway::failure,
    installer::{models::Host, ssh::Ssh},
};
use axum::{
    body::Body,
    http::{Response, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::{net::IpAddr, time::Duration};

/// Runs on the server as root. It only proceeds for a server using an sslip.io
/// address, then hands the switch to the server's own updater, which verifies the
/// new address over HTTPS and restores the old one if that fails.
const SWITCH: &str = r#"set -eu
env_file=/opt/noted/.env
[ -f "$env_file" ] || { echo "NOTED_ERROR: Noted isn't installed in /opt/noted on this server."; exit 0; }
current=$(grep '^NOTED_DOMAIN=' "$env_file" | tail -n 1 | cut -d= -f2-)
case "$current" in
  *.sslip.io) ;;
  *) echo "NOTED_ERROR: This server uses its own domain. Point that domain's DNS to the new IP instead."; exit 0 ;;
esac
[ "$current" = "$NOTED_NEW_DOMAIN" ] && { echo "NOTED_SAME"; exit 0; }
python3 - "$NOTED_NEW_DOMAIN" <<'PY'
import datetime, json, os, sys, uuid
request = {
    "id": str(uuid.uuid4()),
    "action": "domain",
    "domain": sys.argv[1],
    "dns_confirmed": True,
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
path = "/opt/noted/updater/requests/host.json"
temporary = path + ".tmp"
with open(temporary, "w") as file:
    json.dump(request, file)
os.chmod(temporary, 0o600)
os.replace(temporary, path)
print("NOTED_JOB " + request["id"])
PY
"#;

const JOB: &str = "/opt/noted/updater/state/host-job.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddressChange {
    ip: IpAddr,
    port: u16,
    host_key: String,
    password: String,
}

/// The same sslip.io name the setup wizard uses: the IP with dashes.
fn generated_domain(ip: &IpAddr) -> String {
    format!(
        "{}.sslip.io",
        ip.to_string().to_ascii_lowercase().replace(['.', ':'], "-")
    )
}

async fn run(ssh: &Ssh, script: &str, seconds: u64) -> Result<String, String> {
    let mut output = Vec::new();
    ssh.execute("sh -s", script.as_bytes(), seconds, |chunk| {
        output.extend_from_slice(chunk)
    })
    .await?;
    Ok(String::from_utf8_lossy(&output).into_owned())
}

async fn switch(input: &AddressChange) -> Result<String, String> {
    let host = Host {
        ip: input.ip,
        port: input.port,
    };
    host.validate()?;
    let domain = generated_domain(&input.ip);
    let ssh = Ssh::login(&host, input.host_key.clone(), "root", &input.password).await?;
    let output = run(&ssh, &format!("NOTED_NEW_DOMAIN='{domain}'\n{SWITCH}"), 60).await?;
    if let Some(detail) = output
        .lines()
        .find_map(|line| line.strip_prefix("NOTED_ERROR: "))
    {
        return Err(detail.to_string());
    }
    if output.lines().any(|line| line == "NOTED_SAME") {
        return Ok(domain);
    }
    let job = output
        .lines()
        .find_map(|line| line.strip_prefix("NOTED_JOB "))
        .ok_or(
            "The server didn't accept the address change. Check that its Noted updater is running.",
        )?
        .to_string();
    // Getting a certificate for the new address can take a few minutes.
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let raw = run(&ssh, &format!("cat {JOB} 2>/dev/null || true\n"), 20).await?;
        let Ok(status) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        if status["id"] != job.as_str() {
            continue;
        }
        match status["status"].as_str() {
            Some("succeeded") => return Ok(domain),
            Some("failed") | Some("needs_recovery") => {
                return Err(status["detail"]
                    .as_str()
                    .unwrap_or("The server couldn't switch to the new address.")
                    .to_string())
            }
            _ => {}
        }
    }
    Err("The server is still switching. Check again in a few minutes.".into())
}

/// For servers without a domain whose IP changed: their sslip.io address still
/// points to the old IP, so the app can't reach them to fix it from inside.
pub async fn change(Json(input): Json<AddressChange>) -> Response<Body> {
    match switch(&input).await {
        Ok(domain) => {
            Json(serde_json::json!({ "serverUrl": format!("https://{domain}") })).into_response()
        }
        Err(detail) => failure(StatusCode::BAD_GATEWAY, &detail),
    }
}
