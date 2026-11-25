use crate::{connection::Connection, gateway::failure};
use axum::{
    body::Body,
    http::{header, Request, Response, StatusCode},
};
use reqwest::cookie::CookieStore;

pub async fn forward(connection: Connection, request: Request<Body>) -> Response<Body> {
    let (parts, body) = request.into_parts();
    let Some(path) = parts.uri.path_and_query() else {
        return failure(StatusCode::BAD_REQUEST, "Invalid API path.");
    };
    let Ok(url) = connection.url.join(path.as_str()) else {
        return failure(StatusCode::BAD_REQUEST, "Invalid API path.");
    };
    if url.origin() != connection.url.origin() {
        return failure(StatusCode::BAD_REQUEST, "Invalid API destination.");
    }
    let is_login = parts.uri.path() == "/api/v1/auth/login";
    let is_session = parts.uri.path() == "/api/v1/auth/session";
    let is_renewal = parts.uri.path() == "/api/v1/auth/renew";
    let _auth_guard = if parts.uri.path().starts_with("/api/v1/auth/") {
        Some(connection.auth_lock.lock().await)
    } else {
        None
    };
    let is_logout = parts.uri.path() == "/api/v1/auth/logout";
    if is_logout && connection.forget().is_err() {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Could not forget your saved sign-in. Try again.",
        );
    }
    let mut outgoing = connection.client.request(parts.method, url).header(
        header::ORIGIN,
        connection.url.origin().ascii_serialization(),
    );
    for name in [
        header::ACCEPT,
        header::ACCEPT_LANGUAGE,
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::RANGE,
        header::IF_RANGE,
        header::IF_NONE_MATCH,
        header::IF_MODIFIED_SINCE,
    ] {
        if let Some(value) = parts.headers.get(&name) {
            outgoing = outgoing.header(name, value);
        }
    }
    if let Some(cookies) = connection.cookies.cookies(&connection.url) {
        if let Ok(cookies) = cookies.to_str() {
            if let Some(csrf) = cookies
                .split("; ")
                .find_map(|c| c.strip_prefix("noted_csrf="))
            {
                outgoing = outgoing.header("X-CSRF-Token", csrf);
            }
        }
    }
    let mut response = match outgoing
        .body(reqwest::Body::wrap_stream(body.into_data_stream()))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            return failure(
                StatusCode::BAD_GATEWAY,
                "Cannot reach the Noted server. Check your connection.",
            )
        }
    };
    if response.status().is_redirection() {
        return failure(
            StatusCode::BAD_GATEWAY,
            "The server redirected this request. Connect using its final HTTPS address.",
        );
    }
    if is_login
        && response.status().is_success()
        && connection.save_session(response.headers()).is_err()
    {
        let _ = connection.forget();
        connection.clear_cookies();
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Couldn't securely remember this sign-in. Try again or turn off Keep me signed in.",
        );
    }
    if is_renewal && response.status().is_success() {
        let _ = connection.save_session(response.headers());
    }
    let cleared = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .any(|value| value.starts_with("noted_session=") && value.contains("Max-Age=0"));
    if cleared && parts.uri.path().starts_with("/api/v1/auth/") {
        let _ = connection.forget();
        connection.clear_cookies();
    }
    let mut result = Response::builder().status(response.status());
    for (name, value) in response.headers() {
        if !matches!(
            name.as_str(),
            "set-cookie" | "connection" | "transfer-encoding" | "keep-alive" | "upgrade"
        ) {
            result = result.header(name, value);
        }
    }
    if is_session && response.status() == StatusCode::UNAUTHORIZED {
        let json = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
        let mut data = Vec::new();
        let confirmed = json
            && loop {
                match response.chunk().await {
                    Ok(Some(chunk)) if data.len() + chunk.len() <= 4096 => {
                        data.extend_from_slice(&chunk)
                    }
                    Ok(None) => {
                        break serde_json::from_slice::<serde_json::Value>(&data).is_ok_and(
                            |value| {
                                value.get("detail").and_then(|item| item.as_str())
                                    == Some("Sign in to continue")
                            },
                        )
                    }
                    _ => break false,
                }
            };
        if !confirmed {
            return failure(
                StatusCode::BAD_GATEWAY,
                "Couldn't verify your sign-in with the selected Noted server.",
            );
        }
        let _ = connection.forget();
        connection.clear_cookies();
        return result.body(Body::from(data)).unwrap();
    }
    result
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;

    #[tokio::test]
    async fn proxy_retains_credentials_until_a_session_rejection_is_confirmed() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().fallback(|request: Request<Body>| async move {
                    let response = Response::builder().status(StatusCode::UNAUTHORIZED);
                    if request.uri().query() == Some("confirmed=1") {
                        assert!(request.headers()[header::COOKIE]
                            .to_str()
                            .unwrap()
                            .contains("noted_session=test"));
                        response
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(Body::from(r#"{"detail":"Sign in to continue"}"#))
                            .unwrap()
                    } else {
                        response
                            .header(header::CONTENT_TYPE, "text/html")
                            .body(Body::from("<p>Reverse proxy login</p>"))
                            .unwrap()
                    }
                }),
            )
            .await
            .unwrap();
        });
        let connection = Connection::new(format!("http://{address}").parse().unwrap()).unwrap();
        connection
            .cookies
            .add_cookie_str("noted_session=test; Path=/api", &connection.url);
        let session = |path| Request::builder().uri(path).body(Body::empty()).unwrap();
        let ambiguous = forward(connection.clone(), session("/api/v1/auth/session")).await;
        assert_eq!(ambiguous.status(), StatusCode::BAD_GATEWAY);
        let confirmed = forward(
            connection.clone(),
            session("/api/v1/auth/session?confirmed=1"),
        )
        .await;
        assert_eq!(confirmed.status(), StatusCode::UNAUTHORIZED);
        let api = connection.url.join("/api/v1/auth/session").unwrap();
        assert!(connection.cookies.cookies(&api).is_none());
        server.abort();
    }

    async fn upstream(request: Request<Body>) -> Response<Body> {
        if request.uri().path().ends_with("login") {
            return Response::builder()
                .header(
                    header::SET_COOKIE,
                    "noted_session=native-session; HttpOnly; Path=/",
                )
                .header(header::SET_COOKIE, "noted_csrf=native-csrf; Path=/")
                .body(Body::from("signed in"))
                .unwrap();
        }
        assert!(request.headers().get(header::ORIGIN).is_some());
        assert!(!request.headers().contains_key(header::AUTHORIZATION));
        let cookies = request
            .headers()
            .get(header::COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookies.contains("noted_session=native-session"));
        assert!(!cookies.contains("browser-spoof"));
        assert_eq!(request.headers()["x-csrf-token"], "native-csrf");
        assert_eq!(request.headers()[header::RANGE], "bytes=10-19");
        let data = axum::body::to_bytes(request.into_body(), 6 * 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(data.len(), 5 * 1024 * 1024);
        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, "bytes 10-19/100")
            .header(header::CONTENT_LENGTH, "10")
            .body(Body::from("0123456789"))
            .unwrap()
    }

    #[tokio::test]
    async fn native_cookies_replace_browser_credentials_and_stream_files_and_ranges() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(upstream))
                .await
                .unwrap();
        });
        let connection = Connection::new(format!("http://{address}").parse().unwrap()).unwrap();
        let login = forward(
            connection.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(login.status(), StatusCode::OK);
        assert!(!login.headers().contains_key(header::SET_COOKIE));
        let response = forward(
            connection,
            Request::builder()
                .method("POST")
                .uri("/api/v1/upload")
                .header(header::COOKIE, "noted_session=browser-spoof")
                .header(header::AUTHORIZATION, "browser-spoof")
                .header("x-csrf-token", "browser-spoof")
                .header(header::RANGE, "bytes=10-19")
                .body(Body::from(vec![42; 5 * 1024 * 1024]))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 10-19/100");
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 20)
                .await
                .unwrap(),
            "0123456789"
        );
        server.abort();
    }
}
