use crate::session_vault::{now, SavedSession, SessionVault};
use reqwest::cookie::CookieStore;
use reqwest::{cookie::Jar, Client};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use url::Url;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub server_url: Option<String>,
    #[serde(default)]
    pub gateway_port: u16,
}

pub struct ProfileStore(pub PathBuf);

impl ProfileStore {
    pub fn load(&self) -> Profile {
        fs::read(&self.0)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, profile: &Profile) -> std::io::Result<()> {
        fs::create_dir_all(self.0.parent().unwrap())?;
        let temporary = self.0.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec(profile)?)?;
        fs::rename(temporary, &self.0)
    }
}

pub fn server_url(value: &str) -> Result<Url, &'static str> {
    let mut url = Url::parse(value.trim()).map_err(|_| "Enter a complete HTTPS server address.")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("Use HTTPS. HTTP is allowed only for localhost development.");
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err("Use the server origin without a path, credentials, query, or fragment.");
    }
    url.set_path("/");
    Ok(url)
}

#[derive(Clone)]
pub struct Connection {
    pub url: Url,
    pub client: Client,
    pub cookies: Arc<Jar>,
    pub vault: Option<SessionVault>,
    pub remember: Arc<AtomicBool>,
    pub auth_lock: Arc<tokio::sync::Mutex<()>>,
    session_lock: Arc<std::sync::Mutex<()>>,
}

impl Connection {
    pub fn new(url: Url) -> Result<Self, reqwest::Error> {
        let cookies = Arc::new(Jar::default());
        let client = Client::builder()
            .cookie_provider(cookies.clone())
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .user_agent(format!(
                "Noted Desktop/{} ({})",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS
            ))
            .build()?;
        Ok(Self {
            url,
            client,
            cookies,
            vault: None,
            remember: Arc::new(AtomicBool::new(cfg!(windows))),
            auth_lock: Arc::new(tokio::sync::Mutex::new(())),
            session_lock: Arc::new(std::sync::Mutex::new(())),
        })
    }

    pub fn with_store(url: Url, store: &ProfileStore) -> Result<Self, reqwest::Error> {
        let vault = SessionVault::new(&store.0, &url);
        let mut connection = Self::new(url)?;
        if let Ok(Some(saved)) = vault.load() {
            let age = saved.expires_at.saturating_sub(now());
            connection.cookies.add_cookie_str(
                &format!(
                    "noted_session={}; Path=/api; Max-Age={age}; HttpOnly",
                    saved.session
                ),
                &connection.url,
            );
            connection.cookies.add_cookie_str(
                &format!("noted_csrf={}; Path=/; Max-Age={age}", saved.csrf),
                &connection.url,
            );
        }
        connection.vault = Some(vault);
        Ok(connection)
    }

    pub fn forget(&self) -> std::io::Result<()> {
        let _guard = self
            .session_lock
            .lock()
            .map_err(|_| std::io::Error::other("Session storage is unavailable"))?;
        self.remember.store(false, Ordering::SeqCst);
        if let Some(vault) = &self.vault {
            vault.clear()?;
        }
        Ok(())
    }

    pub fn remember_session(&self, enabled: bool) -> std::io::Result<()> {
        self.forget()?;
        self.remember.store(enabled, Ordering::SeqCst);
        Ok(())
    }

    pub fn save_session(&self, headers: &reqwest::header::HeaderMap) -> std::io::Result<()> {
        let _guard = self
            .session_lock
            .lock()
            .map_err(|_| std::io::Error::other("Session storage is unavailable"))?;
        if !self.remember.load(Ordering::SeqCst) {
            return Ok(());
        }
        let Some(vault) = &self.vault else {
            return Ok(());
        };
        let max_age = headers
            .get_all("set-cookie")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .find(|value| value.starts_with("noted_session="))
            .and_then(|value| {
                value
                    .split(';')
                    .map(str::trim)
                    .find_map(|part| part.strip_prefix("Max-Age="))
            })
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing session expiry")
            })?;
        let url = self.url.join("api/v1/auth/session").unwrap();
        let cookies = self.cookies.cookies(&url);
        let value = cookies
            .as_ref()
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        let find = |name: &str| {
            value
                .split("; ")
                .find_map(|part| part.strip_prefix(name))
                .unwrap_or_default()
                .to_owned()
        };
        vault.save(&SavedSession {
            session: find("noted_session="),
            csrf: find("noted_csrf="),
            expires_at: now().saturating_add(max_age),
        })
    }

    pub fn clear_cookies(&self) {
        self.cookies
            .add_cookie_str("noted_session=; Path=/api; Max-Age=0", &self.url);
        self.cookies
            .add_cookie_str("noted_csrf=; Path=/; Max-Age=0", &self.url);
    }

    pub async fn verify(&self) -> Result<(), &'static str> {
        let response = self
            .client
            .get(self.url.join("api/v1/health/ready").unwrap())
            .send()
            .await
            .map_err(|_| "Cannot reach this server. Check the address and HTTPS certificate.")?;
        if !response.status().is_success() {
            return Err("The server is not ready. Check its installation and database.");
        }
        let version = self
            .client
            .get(self.url.join("api/v1/version").unwrap())
            .send()
            .await
            .map_err(|_| "Cannot read the server version.")?
            .json::<serde_json::Value>()
            .await
            .map_err(|_| "This address is not a Noted server.")?;
        if version.get("api_version").and_then(|v| v.as_u64()) != Some(1) {
            return Err("This server requires a different Noted desktop version.");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn remembered_cookies_restore_and_opting_out_prevents_persistence() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProfileStore(directory.path().join("connection.json"));
        let url = server_url("https://session-test.invalid").unwrap();
        let connection = Connection::with_store(url.clone(), &store).unwrap();
        connection
            .cookies
            .add_cookie_str("noted_session=test-session; Path=/api", &url);
        connection
            .cookies
            .add_cookie_str("noted_csrf=test-csrf; Path=/", &url);
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "set-cookie",
            "noted_session=test-session; Path=/api; Max-Age=3600"
                .parse()
                .unwrap(),
        );
        connection.remember_session(true).unwrap();
        connection.save_session(&headers).unwrap();
        let restored = Connection::with_store(url.clone(), &store).unwrap();
        let cookies = restored
            .cookies
            .cookies(&url.join("api/v1/auth/session").unwrap())
            .unwrap();
        assert!(cookies
            .to_str()
            .unwrap()
            .contains("noted_session=test-session"));
        assert!(cookies.to_str().unwrap().contains("noted_csrf=test-csrf"));
        connection.remember_session(false).unwrap();
        connection.save_session(&headers).unwrap();
        let forgotten = Connection::with_store(url.clone(), &store).unwrap();
        assert!(forgotten
            .cookies
            .cookies(&url.join("api/v1/auth/session").unwrap())
            .is_none());
        assert!(!store.0.exists());
    }

    #[test]
    fn origins_require_https_and_reject_credentials_and_paths() {
        for value in [
            "http://example.com",
            "https://owner:password@example.com",
            "https://example.com/api",
            "https://example.com/?secret=x",
            "https://example.com/#x",
            "file:///etc/passwd",
        ] {
            assert!(server_url(value).is_err(), "{value}");
        }
        assert_eq!(
            server_url("https://notes.example.com/").unwrap().as_str(),
            "https://notes.example.com/"
        );
        assert!(server_url("http://localhost:8080").is_ok());
        assert!(server_url("http://127.0.0.1:8080").is_ok());
    }

    #[test]
    fn profiles_persist_only_connection_details() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProfileStore(directory.path().join("connection.json"));
        let profile = Profile {
            server_url: Some("https://notes.example.com".into()),
            gateway_port: 12345,
        };
        store.save(&profile).unwrap();
        store.save(&profile).unwrap();
        assert_eq!(store.load().server_url, profile.server_url);
        let json: serde_json::Value = serde_json::from_slice(&fs::read(&store.0).unwrap()).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 2);
    }
}
