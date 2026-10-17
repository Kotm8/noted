use crate::{
    connection::{server_url, Connection, Profile, ProfileStore},
    proxy,
};
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, Method, Response, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use rand::Rng;
use serde::Deserialize;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

pub struct Gateway {
    pub app: AppHandle,
    pub origin: String,
    pub secret: String,
    pub csrf: String,
    pub port: u16,
    pub store: ProfileStore,
    pub installer: crate::installer::Installer,
    pub connection: RwLock<Option<Connection>>,
}

pub fn token() -> String {
    rand::rng()
        .random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn failure(status: StatusCode, detail: &str) -> Response<Body> {
    (status, Json(serde_json::json!({"detail": detail}))).into_response()
}

async fn protect(
    State(state): State<Arc<Gateway>>,
    request: Request,
    next: Next,
) -> Response<Body> {
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(&format!("127.0.0.1:{}", state.port))
    {
        return failure(StatusCode::FORBIDDEN, "Invalid desktop host.");
    }
    let bootstrap = request.method() == Method::GET
        && request.uri().path() == "/"
        && request.uri().query() == Some(&format!("launch={}", state.secret));
    let auth_name = format!("noted_desktop_{}", state.port);
    if bootstrap {
        return Response::builder()
            .status(StatusCode::SEE_OTHER)
            .header(header::LOCATION, "/")
            .header(
                header::SET_COOKIE,
                format!(
                    "{auth_name}={}; Path=/; HttpOnly; SameSite=Strict",
                    state.secret
                ),
            )
            .header(
                header::SET_COOKIE,
                format!(
                    "noted_csrf_{}={}; Path=/; SameSite=Strict",
                    state.port, state.csrf
                ),
            )
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::empty())
            .unwrap();
    }
    if let Err(detail) = crate::security::authorize(
        request.headers(),
        request.method(),
        state.port,
        &state.origin,
        &state.secret,
        &state.csrf,
    ) {
        return failure(StatusCode::FORBIDDEN, detail);
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert("referrer-policy", "no-referrer".parse().unwrap());
    response.headers_mut().insert("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'".parse().unwrap());
    response
}

async fn current(State(state): State<Arc<Gateway>>) -> Json<Profile> {
    let connection = state.connection.read().await;
    Json(Profile {
        server_url: connection
            .as_ref()
            .map(|c| c.url.origin().ascii_serialization()),
        gateway_port: state.port,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connect {
    server_url: String,
}

async fn connect(State(state): State<Arc<Gateway>>, Json(input): Json<Connect>) -> Response<Body> {
    let url = match server_url(&input.server_url) {
        Ok(url) => url,
        Err(detail) => return failure(StatusCode::BAD_REQUEST, detail),
    };
    let connection = match Connection::new(url) {
        Ok(connection) => connection,
        Err(_) => {
            return failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not initialize the server connection.",
            )
        }
    };
    if let Err(detail) = connection.verify().await {
        return failure(StatusCode::BAD_GATEWAY, detail);
    }
    let profile = Profile {
        server_url: Some(connection.url.origin().ascii_serialization()),
        gateway_port: state.port,
    };
    if state.store.save(&profile).is_err() {
        return failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save the server address.",
        );
    }
    *state.connection.write().await = Some(connection);
    Json(profile).into_response()
}

async fn disconnect(State(state): State<Arc<Gateway>>) -> Response<Body> {
    let profile = Profile {
        server_url: None,
        gateway_port: state.port,
    };
    if state.store.save(&profile).is_err() {
        return failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not forget the server address.",
        );
    }
    *state.connection.write().await = None;
    Json(profile).into_response()
}

async fn serve(State(state): State<Arc<Gateway>>, request: Request) -> Response<Body> {
    if request.uri().path().starts_with("/api/") {
        let connection = state.connection.read().await.clone();
        return match connection {
            Some(connection) => proxy::forward(connection, request).await,
            None => failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Connect to your Noted server first.",
            ),
        };
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return failure(StatusCode::METHOD_NOT_ALLOWED, "Unsupported request.");
    }
    let path = request.uri().path().trim_start_matches('/');
    let resolver = state.app.asset_resolver();
    match resolver
        .get(path.to_owned())
        .or_else(|| resolver.get("index.html".into()))
    {
        Some(asset) => Response::builder()
            .header(header::CONTENT_TYPE, asset.mime_type)
            .body(if request.method() == Method::HEAD {
                Body::empty()
            } else {
                Body::from(asset.bytes)
            })
            .unwrap(),
        None => failure(StatusCode::NOT_FOUND, "Application assets are unavailable."),
    }
}

pub fn router(state: Arc<Gateway>) -> Router {
    Router::new()
        .route(
            "/desktop/connection",
            get(current).put(connect).delete(disconnect),
        )
        .route(
            "/desktop/setup",
            get(crate::installer::status).post(crate::installer::start),
        )
        .route(
            "/desktop/setup/host",
            axum::routing::post(crate::installer::probe),
        )
        .route(
            "/desktop/setup/release",
            axum::routing::post(crate::installer::check_release),
        )
        .route(
            "/desktop/setup/verify",
            axum::routing::post(crate::installer::verify),
        )
        .fallback(serve)
        .layer(middleware::from_fn_with_state(state.clone(), protect))
        .with_state(state)
}
