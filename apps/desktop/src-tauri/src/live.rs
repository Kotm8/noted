use crate::{connection::Connection, gateway::failure};
use axum::{
    body::Body,
    extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    http::{header, HeaderMap, Response, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use reqwest::cookie::CookieStore;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        client::IntoClientRequest, protocol::CloseFrame as RemoteClose, Message as Remote,
    },
    MaybeTlsStream, WebSocketStream,
};

fn upstream_request(connection: &Connection) -> Result<axum::http::Request<()>, &'static str> {
    let mut url = connection
        .url
        .join("/api/v1/live")
        .map_err(|_| "Invalid server address.")?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme)
        .map_err(|_| "Invalid server protocol.")?;
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "Invalid live address.")?;
    request.headers_mut().insert(
        header::ORIGIN,
        connection
            .url
            .origin()
            .ascii_serialization()
            .parse()
            .map_err(|_| "Invalid server origin.")?,
    );
    let cookies = connection
        .cookies
        .cookies(&connection.url)
        .ok_or("Sign in to continue.")?;
    request.headers_mut().insert(header::COOKIE, cookies);
    Ok(request)
}

pub async fn forward(
    connection: Connection,
    headers: HeaderMap,
    origin: &str,
    upgrade: WebSocketUpgrade,
) -> Response<Body> {
    if headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        != Some(origin)
    {
        return failure(StatusCode::FORBIDDEN, "Untrusted desktop origin.");
    }
    let request = match upstream_request(&connection) {
        Ok(request) => request,
        Err(detail) => return failure(StatusCode::UNAUTHORIZED, detail),
    };
    let remote = match tokio::time::timeout(Duration::from_secs(15), connect_async(request)).await {
        Ok(Ok((remote, _))) => remote,
        _ => return failure(StatusCode::BAD_GATEWAY, "Live updates are unavailable."),
    };
    upgrade
        .max_message_size(8192)
        .max_frame_size(8192)
        .on_upgrade(|socket| relay(socket, remote))
        .into_response()
}

async fn relay(socket: WebSocket, remote: WebSocketStream<MaybeTlsStream<TcpStream>>) {
    let (mut local_send, mut local_read) = socket.split();
    let (mut remote_send, mut remote_read) = remote.split();
    let outgoing = async {
        while let Some(Ok(message)) = local_read.next().await {
            let message = match message {
                Message::Text(value) => Remote::Text(value.as_str().into()),
                Message::Binary(value) => Remote::Binary(value),
                Message::Ping(value) => Remote::Ping(value),
                Message::Pong(value) => Remote::Pong(value),
                Message::Close(value) => Remote::Close(value.map(|frame| RemoteClose {
                    code: frame.code.into(),
                    reason: frame.reason.as_str().into(),
                })),
            };
            let closing = message.is_close();
            if !matches!(
                tokio::time::timeout(Duration::from_secs(5), remote_send.send(message)).await,
                Ok(Ok(()))
            ) || closing
            {
                break;
            }
        }
    };
    let incoming = async {
        while let Some(Ok(message)) = remote_read.next().await {
            let message = match message {
                Remote::Text(value) => Message::Text(value.as_str().into()),
                Remote::Binary(value) => Message::Binary(value),
                Remote::Ping(value) => Message::Ping(value),
                Remote::Pong(value) => Message::Pong(value),
                Remote::Close(value) => Message::Close(value.map(|frame| CloseFrame {
                    code: frame.code.into(),
                    reason: frame.reason.as_str().into(),
                })),
                Remote::Frame(_) => continue,
            };
            let closing = matches!(message, Message::Close(_));
            if !matches!(
                tokio::time::timeout(Duration::from_secs(5), local_send.send(message)).await,
                Ok(Ok(()))
            ) || closing
            {
                break;
            }
        }
    };
    tokio::select! { _ = outgoing => {}, _ = incoming => {} }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, routing::get, Router};
    use std::future::IntoFuture;

    async fn upstream(headers: HeaderMap, upgrade: WebSocketUpgrade) -> impl IntoResponse {
        assert_eq!(headers[header::ORIGIN], headers["expected-origin"]);
        let cookies = headers[header::COOKIE].to_str().unwrap();
        assert!(cookies.contains("noted_session=native-session"));
        assert!(cookies.contains("noted_csrf=native-csrf"));
        assert!(!cookies.contains("browser-spoof"));
        assert!(!headers.contains_key(header::AUTHORIZATION));
        upgrade.on_upgrade(async |mut socket| {
            socket.send(Message::Text("hello".into())).await.unwrap();
            assert_eq!(
                socket.recv().await.unwrap().unwrap().into_text().unwrap(),
                "from-window"
            );
            socket
                .send(Message::Close(Some(CloseFrame {
                    code: 1000,
                    reason: "signed out".into(),
                })))
                .await
                .unwrap();
        })
    }

    async fn local(
        State((connection, origin)): State<(Connection, String)>,
        headers: HeaderMap,
        upgrade: WebSocketUpgrade,
    ) -> Response<Body> {
        forward(connection, headers, &origin, upgrade).await
    }

    #[tokio::test]
    async fn native_credentials_replace_browser_headers_and_frames_and_close_are_forwarded() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let expected = origin.clone();
        let server = tokio::spawn(async move {
            let app = Router::new().route(
                "/api/v1/live",
                get(move |mut headers: HeaderMap, upgrade: WebSocketUpgrade| {
                    headers.insert("expected-origin", expected.parse().unwrap());
                    upstream(headers, upgrade)
                }),
            );
            axum::serve(listener, app).await.unwrap();
        });
        let connection = Connection::new(origin.parse().unwrap()).unwrap();
        connection
            .cookies
            .add_cookie_str("noted_session=native-session; Path=/", &connection.url);
        connection
            .cookies
            .add_cookie_str("noted_csrf=native-csrf; Path=/", &connection.url);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let local_origin = format!("http://{address}");
        let gateway = tokio::spawn(
            axum::serve(
                listener,
                Router::new()
                    .route("/api/v1/live", get(local))
                    .with_state((connection, local_origin.clone())),
            )
            .into_future(),
        );
        let mut request = format!("ws://{address}/api/v1/live")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert(header::ORIGIN, local_origin.parse().unwrap());
        request.headers_mut().insert(
            header::COOKIE,
            "noted_session=browser-spoof".parse().unwrap(),
        );
        request.headers_mut().insert(
            header::AUTHORIZATION,
            "Bearer browser-spoof".parse().unwrap(),
        );
        let mut forged = request.clone();
        forged
            .headers_mut()
            .insert(header::ORIGIN, "https://untrusted.example".parse().unwrap());
        let Err(tokio_tungstenite::tungstenite::Error::Http(response)) =
            connect_async(forged).await
        else {
            panic!("A foreign origin reached the desktop socket");
        };
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let (mut socket, _) = connect_async(request).await.unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            "hello"
        );
        socket
            .send(Remote::Text("from-window".into()))
            .await
            .unwrap();
        let Remote::Close(Some(frame)) = socket.next().await.unwrap().unwrap() else {
            panic!("No close frame");
        };
        assert_eq!(u16::from(frame.code), 1000);
        assert_eq!(frame.reason.as_str(), "signed out");
        gateway.abort();
        server.abort();
    }

    #[test]
    fn unsigned_connections_cannot_open_an_upstream_socket() {
        let connection = Connection::new("https://noted.example".parse().unwrap()).unwrap();
        assert!(upstream_request(&connection).is_err());
    }
}
