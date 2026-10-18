use super::{
    models::{Host, InstallRequest, Job},
    release,
    ssh::Ssh,
    Installer, PACKAGE, PREPARE,
};
use serde_json::json;
use std::io::{Read, Write};

#[test]
fn bundled_linux_scripts_use_unix_line_endings() {
    assert!(!PREPARE.contains('\r'));
    let mut archive = tar::Archive::new(PACKAGE);
    let mut scripts = 0;
    for entry in archive.entries().unwrap() {
        let mut entry = entry.unwrap();
        let path = entry.path().unwrap().into_owned();
        if path.extension().is_some_and(|extension| extension == "sh") {
            let mut contents = String::new();
            entry.read_to_string(&mut contents).unwrap();
            assert!(!contents.contains('\r'), "{}", path.display());
            scripts += 1;
        }
    }
    assert!(scripts > 0);
}

#[test]
fn cleanup_requires_ssh_credentials_a_reviewed_snapshot_and_exact_confirmation() {
    use super::cleanup::CleanupRequest;
    let mut request = CleanupRequest {
        ssh_password: "test-password".into(),
        confirmation: None,
        snapshot: None,
    };
    assert!(request.validate(false).is_ok());
    assert!(request.validate(true).is_err());
    request.confirmation = Some("I LOVE VERITY".into());
    request.snapshot = Some("c".repeat(64));
    assert!(request.validate(true).is_ok());
    request.confirmation = Some("i love verity".into());
    assert!(request.validate(true).is_err());
    request.ssh_password.clear();
    assert!(request.validate(false).is_err());
}

fn manifest() -> serde_json::Value {
    json!({
        "format": 1, "channel": "main", "configuration_version": 1, "api_version": 1,
        "minimum_updater_version": 2, "repository": "owner/noted", "commit": "a".repeat(40),
        "sequence": 1, "version": "0.1.0", "schema_revision": "0006_channel_banners",
        "supported_source_schemas": ["0006_channel_banners"],
        "backend_image": format!("ghcr.io/owner/noted-backend@sha256:{}", "b".repeat(64)),
        "web_image": format!("ghcr.io/owner/noted-web@sha256:{}", "c".repeat(64)),
        "bundle_sha256": "d".repeat(64)
    })
}

fn archive(names: &[&str], link: bool) -> Vec<u8> {
    let compressed = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    let mut archive = tar::Builder::new(compressed);
    for name in names {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        if link {
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            header.set_link_name("/etc/passwd").unwrap();
            archive.append_data(&mut header, name, &[][..]).unwrap();
        } else {
            header.set_size(4);
            archive
                .append_data(&mut header, name, &b"test"[..])
                .unwrap();
        }
    }
    archive.into_inner().unwrap().finish().unwrap()
}

#[test]
fn rejects_untrusted_images_and_incompatible_releases() {
    let data = manifest();
    assert!(release::validate_manifest(&data, "owner/noted").is_ok());
    for (name, value) in [
        ("backend_image", json!("ghcr.io/owner/noted-backend:latest")),
        (
            "web_image",
            json!(format!("ghcr.io/another/web@sha256:{}", "c".repeat(64))),
        ),
        ("api_version", json!(2)),
        ("minimum_updater_version", json!(3)),
        ("sequence", json!(-1)),
        ("commit", json!("../../other")),
    ] {
        let mut invalid = data.clone();
        invalid[name] = value;
        assert!(
            release::validate_manifest(&invalid, "owner/noted").is_err(),
            "{name}"
        );
    }
    assert!(release::validate_manifest(&data, "another/noted").is_err());
}

#[test]
fn rejects_changed_unsafe_and_oversized_deployment_archives() {
    let files = ["compose.production.yaml", "Caddyfile.production"];
    let good = archive(&files, false);
    assert!(release::deployment(&good, &release::checksum(&good)).is_ok());
    assert!(release::deployment(&good, &"0".repeat(64)).is_err());
    for bytes in [
        archive(&files, true),
        archive(&files[..1], false),
        archive(&[files[0], files[0]], false),
        archive(&[files[0], "unwanted.sh"], false),
    ] {
        assert!(release::deployment(&bytes, &release::checksum(&bytes)).is_err());
    }
    let mut compressed = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    compressed.write_all(&vec![0; 3145729]).unwrap();
    let bytes = compressed.finish().unwrap();
    assert!(release::deployment(&bytes, &release::checksum(&bytes)).is_err());
}

#[test]
fn setup_state_remembers_recovery_details_without_credentials() {
    let request: InstallRequest = serde_json::from_value(json!({
        "plan": {"host": {"ip": "203.0.113.10", "port": 22}, "hostKey": "ssh-ed25519 fixture",
            "serverName": "My notes", "domain": "notes.example.com", "username": "owner",
            "repository": "owner/noted", "releaseCommit": "a".repeat(40), "manifestSha256": "b".repeat(64)},
        "sshUser": "root", "sshPassword": "ssh-secret-only", "password": "owner-password-only"
    })).unwrap();
    request.validate().unwrap();
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("setup.json");
    let installer = Installer::new(path.clone());
    let job = Job {
        status: "running".into(),
        phase: "images".into(),
        detail: "Downloading images".into(),
        plan: Some(request.plan),
    };
    installer.save(&job).unwrap();
    let saved = std::fs::read_to_string(&path).unwrap();
    assert!(!saved.contains(&request.password));
    assert!(!saved.contains(&request.ssh_password));
    let recovered = Installer::new(path);
    let recovered = recovered.job.lock().unwrap();
    assert_eq!(recovered.status, "failed");
    assert_eq!(recovered.phase, "images");
    assert!(recovered.detail.contains("interrupted"));
}

#[tokio::test]
#[ignore = "Requires the isolated fixture from scripts/test_desktop_ssh.py"]
async fn ssh_round_trip_and_preflight() {
    let port = std::env::var("NOTED_SSH_TEST_PORT")
        .unwrap()
        .parse()
        .unwrap();
    let host = Host {
        ip: "127.0.0.1".parse().unwrap(),
        port,
    };
    let expected = std::env::var("NOTED_SSH_TEST_KEY").unwrap();
    let identity = Ssh::probe(&host).await.unwrap();
    assert_eq!(identity.host_key, expected);
    assert!(identity.fingerprint.starts_with("SHA256:"));
    assert!(Ssh::login(
        &host,
        format!("{expected}-changed"),
        "root",
        "noted-fixture-password"
    )
    .await
    .is_err());
    assert!(
        Ssh::login(&host, expected.clone(), "root", "wrong-password")
            .await
            .is_err()
    );
    let ssh = Ssh::login(&host, expected, "root", "noted-fixture-password")
        .await
        .unwrap();
    let payload = vec![42; 5 * 1024 * 1024];
    let mut received = Vec::new();
    assert_eq!(
        ssh.execute(
            "python3 -c 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())'",
            &payload,
            30,
            |bytes| received.extend_from_slice(bytes)
        )
        .await
        .unwrap(),
        0
    );
    assert_eq!(received, payload);
    assert!(ssh.execute("sleep 5", &[], 1, |_| {}).await.is_err());
    let prepare = format!(
        "NOTED_SETUP_ID='{}'\nNOTED_SETUP_CHECK_ONLY=1\n{PREPARE}",
        "a".repeat(64)
    );
    assert_eq!(
        ssh.execute("sh -s", prepare.as_bytes(), 30, |_| {})
            .await
            .unwrap(),
        0
    );
    assert_eq!(ssh.execute("sh -c 'nohup python3 -m http.server 80 >/dev/null 2>&1 & echo $! > /tmp/noted-test-http.pid'", &[], 10, |_| {}).await.unwrap(), 0);
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert_eq!(
        ssh.execute("sh -s", prepare.as_bytes(), 30, |_| {})
            .await
            .unwrap(),
        35
    );
    assert_eq!(ssh.execute("kill $(cat /tmp/noted-test-http.pid); mkdir -p /opt/noted; printf untouched > /opt/noted/existing-file", &[], 10, |_| {}).await.unwrap(), 0);
    assert_eq!(
        ssh.execute("sh -s", prepare.as_bytes(), 30, |_| {})
            .await
            .unwrap(),
        34
    );
    let mut preserved = Vec::new();
    ssh.execute("cat /opt/noted/existing-file", &[], 10, |bytes| {
        preserved.extend_from_slice(bytes)
    })
    .await
    .unwrap();
    assert_eq!(preserved, b"untouched");
    ssh.execute(&format!("printf '{}' > /opt/noted/.setup-id", "a".repeat(64)), &[], 10, |_| {}).await.unwrap();
    let plan = super::models::Plan {
        host: host.clone(), host_key: identity.host_key, server_name: "Fixture".into(),
        domain: "notes.example.com".into(), username: "owner".into(), repository: "owner/noted".into(),
        release_commit: "a".repeat(40), manifest_sha256: "b".repeat(64),
    };
    let mut request = super::cleanup::CleanupRequest {
        ssh_password: "noted-fixture-password".into(), confirmation: None, snapshot: None,
    };
    let inspection = super::cleanup::execute(&plan, &request, false).await.unwrap();
    assert_eq!(inspection["present"], true);
    request.snapshot = Some(inspection["snapshot"].as_str().unwrap().into());
    request.confirmation = Some("I LOVE VERITY".into());
    let result = super::cleanup::execute(&plan, &request, true).await.unwrap();
    assert_eq!(result["removed"], true);
    assert_eq!(result["directoryRetained"], true);
    let mut preserved = Vec::new();
    assert_eq!(ssh.execute("cat /opt/noted/existing-file; test ! -e /opt/noted/.setup-id", &[], 10, |chunk| preserved.extend_from_slice(chunk)).await.unwrap(), 0);
    assert_eq!(preserved, b"untouched");
}
