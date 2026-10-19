use super::{
    models::{InstallRequest, Plan},
    progress::Progress,
    release, ssh, PACKAGE, PREPARE,
};
use crate::{
    connection::{server_url, Connection, Profile},
    gateway::Gateway,
};
use std::time::Duration;

pub(super) async fn install(state: &Gateway, input: InstallRequest) -> Result<(), String> {
    let plan = &input.plan;
    let release = release::load(&plan.repository, Some(&plan.release_commit)).await?;
    if release.manifest_sha256 != plan.manifest_sha256 || release.commit != plan.release_commit {
        return Err(
            "The release changed since review. Check the release again before installing.".into(),
        );
    }
    state.installer.update(
        "ssh",
        "Verifying the SSH host key and signing into the VPS.",
        "running",
    );
    let ssh = ssh::Ssh::login(
        &plan.host,
        plan.host_key.clone(),
        &input.ssh_user,
        &input.ssh_password,
    )
    .await?;
    let identity = serde_json::to_vec(plan).unwrap();
    let setup_id = release::checksum(&identity);
    let prepare = format!("NOTED_SETUP_ID='{setup_id}'\n{PREPARE}");
    state.installer.update(
        "preflight",
        "Checking the OS, free space, existing installation, and web ports.",
        "running",
    );
    let check = format!("NOTED_SETUP_CHECK_ONLY=1\n{prepare}");
    preparation_result(ssh.execute("sh -s", check.as_bytes(), 60, |_| {}).await?)?;
    state.installer.update(
        "docker",
        "Preparing Docker and the server installation directory.",
        "running",
    );
    preparation_result(
        ssh.execute("sh -s", prepare.as_bytes(), 1800, |_| {})
            .await?,
    )?;
    state.installer.update(
        "upload",
        "Uploading the installation scripts and verified deployment files.",
        "running",
    );
    for archive in [PACKAGE, release.deployment.as_slice()] {
        if ssh
            .execute("umask 077; tar -xf - -C /opt/noted", archive, 120, |_| {})
            .await?
            != 0
        {
            return Err("Could not upload the installation files.".into());
        }
    }
    let data = serde_json::json!({
        "setup_id": setup_id,
        "repository": plan.repository,
        "domain": plan.domain,
        "server_name": plan.server_name,
        "username": plan.username,
        "password": input.password,
        "android_notifications": input.android_notifications,
        "release": release.manifest,
    });
    let bytes = serde_json::to_vec(&data).unwrap();
    let mut progress = Progress::default();
    let code = ssh
        .execute(
            "umask 077; PYTHONPATH=/opt/noted/updater/code python3 -m noted_updater.install",
            &bytes,
            3600,
            |chunk| progress.receive(chunk, &state.installer),
        )
        .await?;
    if code != 0 {
        return Err("The server step failed. Check VPS network access, public image availability, and the supplied owner credentials. Retry with the same details; existing data is kept.".into());
    }
    state.installer.update("https", "Noted is installed. Point your domain to the VPS and allow TCP 80 and 443, then check the connection.", "waiting_dns");
    Ok(())
}

fn preparation_result(code: u32) -> Result<(), String> {
    match code {
        0 => Ok(()),
        30 => Err("Use the root SSH account for initial setup.".into()),
        31 => Err("This server release requires an x86_64 VPS.".into()),
        32 => Err("Use Ubuntu 24.04/26.04 or Debian 12/13 for this installer.".into()),
        33 => Err("This installer requires a Linux VPS running systemd.".into()),
        34 => Err("An existing Noted installation was found. Connect to it, or retry with exactly the original setup details. Nothing was replaced.".into()),
        35 => Err("Port 80 or 443 is already in use. Resolve that conflict before installing; existing services were kept.".into()),
        36 => Err("Install iproute2 on the VPS so setup can check occupied ports.".into()),
        37 => Err("Docker exists but its Compose plugin is missing. Install the plugin before continuing.".into()),
        38 => Err("Docker exists but is not running. Start it before continuing.".into()),
        39 => Err("Free at least 2 GiB on the VPS before installing.".into()),
        _ => Err("Server preparation failed. Check the package repositories and available disk space, then retry.".into()),
    }
}

pub(super) async fn verify_connection(state: &Gateway, plan: &Plan) -> Result<(), String> {
    let url = server_url(&format!("https://{}", plan.domain))?;
    let connection = Connection::with_store(url, &state.store)
        .map_err(|_| "Could not initialize the HTTPS connection.")?;
    tokio::time::timeout(Duration::from_secs(30), connection.verify())
        .await
        .map_err(|_| {
            "HTTPS is not ready yet. Check DNS and inbound ports 80/443, then try again."
        })??;
    let actual: serde_json::Value = connection
        .client
        .get(connection.url.join("api/v1/version").unwrap())
        .send()
        .await
        .map_err(|_| "Could not verify the installed release.")?
        .json()
        .await
        .map_err(|_| "Could not read the installed version.")?;
    if actual["build_commit"] != plan.release_commit {
        return Err(
            "This domain points to a different Noted release. Check its DNS record.".into(),
        );
    }
    let profile = Profile {
        server_url: Some(connection.url.origin().ascii_serialization()),
        gateway_port: state.port,
    };
    state
        .store
        .save(&profile)
        .map_err(|_| "Could not save the installed server address.")?;
    *state.connection.write().await = Some(connection);
    Ok(())
}
