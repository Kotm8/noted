#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod address;
mod client_updates;
mod connection;
mod devices;
mod gateway;
mod installer;
mod proxy;
mod security;
mod session_vault;
mod startup;

use connection::{server_url, Connection, ProfileStore};
use std::{net::TcpListener, sync::Arc};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tokio::sync::RwLock;

fn open_link(url: &url::Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = webbrowser::open(url.as_str());
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![startup::AUTOSTART_ARGUMENT]),
        ))
        .setup(|app| {
            let mut directory = app.path().app_config_dir()?;
            if cfg!(debug_assertions) {
                if let Some(value) = std::env::var_os("NOTED_DESKTOP_TEST_DIRECTORY") {
                    directory = value.into();
                }
            }
            let store = ProfileStore(directory.join("connection.json"));
            let mut profile = store.load();
            let listener = TcpListener::bind(("127.0.0.1", profile.gateway_port))
                .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))?;
            listener.set_nonblocking(true)?;
            profile.gateway_port = listener.local_addr()?.port();
            store.save(&profile)?;
            let connection = profile
                .server_url
                .as_deref()
                .and_then(|s| server_url(s).ok())
                .and_then(|url| Connection::with_store(url, &store).ok());
            let origin = format!("http://127.0.0.1:{}", profile.gateway_port);
            let state = Arc::new(gateway::Gateway {
                app: app.handle().clone(),
                origin: origin.clone(),
                secret: gateway::token(),
                csrf: gateway::token(),
                port: profile.gateway_port,
                store,
                installer: installer::Installer::new(directory.join("setup.json")),
                devices: devices::Devices::new(&directory),
                startup: startup::Startup::new(&directory),
                connection: RwLock::new(connection),
                client_updates: client_updates::ClientUpdates::new(),
            });
            state.client_updates.schedule(app.handle().clone());
            let minimized = std::env::args().any(|argument| argument == startup::AUTOSTART_ARGUMENT)
                && state.startup.load().minimized;
            let launch = format!("{origin}/?launch={}", state.secret);
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                if let Err(error) = axum::serve(listener, gateway::router(state)).await {
                    eprintln!("Desktop connection stopped: {error}");
                }
            });
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(launch.parse()?))
                    .title("Noted")
                    .inner_size(1280.0, 840.0)
                    .min_inner_size(800.0, 560.0)
                    .background_color(tauri::window::Color(31, 31, 31, 255))
                    .visible(!minimized)
                    .on_navigation(move |url| {
                        if url.origin().ascii_serialization() == origin {
                            true
                        } else {
                            open_link(url);
                            false
                        }
                    })
                    .on_new_window(|url, _| {
                        open_link(&url);
                        NewWindowResponse::Deny
                    });
            if cfg!(debug_assertions) {
                if std::env::var_os("NOTED_DESKTOP_TEST_DIRECTORY").is_some() {
                    window = window.data_directory(directory.join("webview"));
                }
                if let Some(downloads) = std::env::var_os("NOTED_DESKTOP_TEST_DOWNLOADS") {
                    let downloads = std::path::PathBuf::from(downloads);
                    window = window.on_download(move |_, event| {
                        if let DownloadEvent::Requested { destination, .. } = event {
                            if let Some(name) = destination.file_name() {
                                *destination = downloads.join(name);
                            }
                        }
                        true
                    });
                }
                if let Ok(port) = std::env::var("NOTED_DESKTOP_DEBUG_PORT") {
                    let port: u16 = port.parse()?;
                    window =
                        window.additional_browser_args(&format!("--remote-debugging-port={port}"));
                }
            }
            let window = window.build()?;
            if minimized {
                // Built hidden and minimized before showing, so it lands on the taskbar
                // without flashing open.
                window.minimize()?;
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not start Noted desktop");
}
