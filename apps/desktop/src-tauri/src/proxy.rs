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
    let response = match outgoing
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
    let mut result = Response::builder().status(response.status());
    for (name, value) in response.headers() {
        if !matches!(
            name.as_str(),
            "set-cookie" | "connection" | "transfer-encoding" | "keep-alive" | "upgrade"
        ) {
            result = result.header(name, value);
        }
    }
    result
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;

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
