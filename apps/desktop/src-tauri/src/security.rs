use axum::http::{header, HeaderMap, Method};

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let prefix = format!("{name}=");
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|c| c.trim().strip_prefix(&prefix))
}

pub fn authorize(
    headers: &HeaderMap,
    method: &Method,
    port: u16,
    origin: &str,
    secret: &str,
    csrf: &str,
) -> Result<(), &'static str> {
    if headers.get(header::HOST).and_then(|v| v.to_str().ok()) != Some(&format!("127.0.0.1:{port}"))
    {
        return Err("Invalid desktop host.");
    }
    if cookie(headers, &format!("noted_desktop_{port}")) != Some(secret) {
        return Err("Open this address through the Noted desktop app.");
    }
    if let Some(value) = headers.get(header::ORIGIN) {
        if value.to_str().ok() != Some(origin) {
            return Err("Untrusted request origin.");
        }
    }
    if let Some(site) = headers.get("sec-fetch-site") {
        if !matches!(site.to_str().ok(), Some("same-origin" | "none")) {
            return Err("Untrusted request site.");
        }
    }
    if !matches!(*method, Method::GET | Method::HEAD)
        && (headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) != Some(origin)
            || headers.get("x-csrf-token").and_then(|v| v.to_str().ok()) != Some(csrf))
    {
        return Err("Invalid desktop request token.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in [
            ("host", "127.0.0.1:12345"),
            ("cookie", "noted_desktop_12345=launch-secret"),
            ("origin", "http://127.0.0.1:12345"),
            ("x-csrf-token", "csrf-secret"),
            ("sec-fetch-site", "same-origin"),
        ] {
            headers.insert(name, value.parse().unwrap());
        }
        headers
    }

    fn allowed(headers: &HeaderMap, method: Method) -> bool {
        authorize(
            headers,
            &method,
            12345,
            "http://127.0.0.1:12345",
            "launch-secret",
            "csrf-secret",
        )
        .is_ok()
    }

    #[test]
    fn local_requests_need_the_private_cookie_origin_and_csrf() {
        assert!(allowed(&headers(), Method::POST));
        for name in ["host", "cookie", "origin", "x-csrf-token"] {
            let mut missing = headers();
            missing.remove(name);
            assert!(!allowed(&missing, Method::POST), "{name}");
        }
        for (name, value) in [
            ("host", "evil.example:12345"),
            ("cookie", "noted_desktop_12345=wrong"),
            ("origin", "http://127.0.0.1:9999"),
            ("x-csrf-token", "wrong"),
            ("sec-fetch-site", "same-site"),
        ] {
            let mut forged = headers();
            forged.insert(name, value.parse().unwrap());
            assert!(!allowed(&forged, Method::POST), "{name}");
            if name != "x-csrf-token" {
                assert!(!allowed(&forged, Method::GET), "{name}");
            }
        }
        let mut read = headers();
        read.remove("origin");
        read.remove("x-csrf-token");
        assert!(allowed(&read, Method::GET));
    }
}
