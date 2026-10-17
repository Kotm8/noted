use reqwest::{cookie::Jar, Client};
use serde::{Deserialize, Serialize};
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
        })
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
