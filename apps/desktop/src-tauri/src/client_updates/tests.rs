use axum::{routing::get, Json, Router};
use std::time::Duration;
use tauri_plugin_updater::UpdaterExt;

const PAYLOAD: &[u8] = b"Noted updater verification fixture";
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3QgcHVibGljIGtleQpSV1IwWlhOMExXdGxlWDNyWjE2ZDJrWlRmQlRWM0hLcHMybUlURDk1bkdzSXhuVDlBN2FZbVJ3SQ==";
const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3Qgc2lnbmF0dXJlClJVUjBaWE4wTFd0bGVaVXVkTW9VMnpXZTlaeDJobWdZb01TYWlrcmczV1VuODFEc0JjdXREcGhPYUF0bktnSG4rOG0wQ1dLaDBxdTVrbkF3a0RpbkJta1ZRazEzTzh0M3lRQT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTcwMDAwMDAwMAlmaWxlOnRlc3QuZXhlCXZlcnNpb246Mi4wLjAKaW1ELzVNemFmR0FGUnY0QUx6Smh0STgxVTB6WStodDFmTVpaWkF0OVI2ZGx3UkFMVUdCSHRWTnMxa2NRV2VOVE9HT0h1SmFmUjhXeC9ZTDVMWWVORFE9PQ==";

#[tokio::test]
async fn signed_downloads_reject_altered_packages_and_mismatched_versions() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let feed = |version: &str, path: &str| {
        serde_json::json!({
            "version": version,
            "platforms": {
                "windows-x86_64": {
                    "url": format!("{origin}/{path}"),
                    "signature": SIGNATURE
                }
            }
        })
    };
    let good = feed("2.0.0", "payload");
    let tampered = feed("2.0.0", "tampered");
    let mismatch = feed("9.9.9", "payload");
    let old = feed("0.0.0", "payload");
    let router = Router::new()
        .route("/feed", get(move || async move { Json(good) }))
        .route("/tampered-feed", get(move || async move { Json(tampered) }))
        .route("/mismatch-feed", get(move || async move { Json(mismatch) }))
        .route("/old-feed", get(move || async move { Json(old) }))
        .route("/payload", get(|| async { PAYLOAD }))
        .route("/tampered", get(|| async { b"changed package".as_slice() }));
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": PUBLIC_KEY,
            "requireSignedVersion": true,
            "dangerousInsecureTransportProtocol": true
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = |endpoint: &str| {
        app.updater_builder()
            .endpoints(vec![format!("{origin}/{endpoint}").parse().unwrap()])
            .unwrap()
            .target("windows-x86_64")
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .build()
            .unwrap()
    };
    let update = updater("feed").check().await.unwrap().unwrap();
    assert_eq!(update.version, "2.0.0");
    assert_eq!(update.download(|_, _| {}, || {}).await.unwrap(), PAYLOAD);
    assert!(update.verify(b"changed package").is_err());
    assert!(updater("tampered-feed")
        .check()
        .await
        .unwrap()
        .unwrap()
        .download(|_, _| {}, || {})
        .await
        .is_err());
    assert!(updater("mismatch-feed")
        .check()
        .await
        .unwrap()
        .unwrap()
        .download(|_, _| {}, || {})
        .await
        .is_err());
    assert!(updater("old-feed").check().await.unwrap().is_none());
    server.abort();
}
