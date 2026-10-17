use super::models::Host;
use russh::{
    client,
    keys::{HashAlg, PublicKeyOrCertificate},
    ChannelMsg, Disconnect,
};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::timeout;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub host_key: String,
    pub fingerprint: String,
}

struct Handler {
    expected: Option<String>,
    found: Arc<Mutex<Option<Identity>>>,
}

impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        if key.certificate().is_some() {
            return Ok(false);
        }
        let key = key.public_key();
        let encoded = key.to_openssh().map_err(|_| russh::Error::UnknownKey)?;
        if self
            .expected
            .as_ref()
            .is_some_and(|expected| expected != &encoded)
        {
            return Ok(false);
        }
        *self.found.lock().unwrap() = Some(Identity {
            host_key: encoded,
            fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        });
        Ok(true)
    }
}

pub struct Ssh(client::Handle<Handler>);

impl Ssh {
    async fn connect(host: &Host, expected: Option<String>) -> Result<(Self, Identity), String> {
        host.validate()?;
        let found = Arc::new(Mutex::new(None));
        let handler = Handler {
            expected,
            found: found.clone(),
        };
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(120)),
            keepalive_interval: Some(Duration::from_secs(15)),
            ..Default::default()
        });
        let session = timeout(Duration::from_secs(20), client::connect(config, (host.ip, host.port), handler)).await
            .map_err(|_| "SSH connection timed out.")?.map_err(|_| "Could not connect over SSH, or the host key changed. Verify the server IP, port, and fingerprint.")?;
        let identity = found
            .lock()
            .unwrap()
            .clone()
            .ok_or("The server did not provide a supported SSH host key.")?;
        Ok((Self(session), identity))
    }

    pub async fn probe(host: &Host) -> Result<Identity, String> {
        let (ssh, identity) = Self::connect(host, None).await?;
        let _ = ssh
            .0
            .disconnect(Disconnect::ByApplication, "Host key inspection", "en")
            .await;
        Ok(identity)
    }

    pub async fn login(
        host: &Host,
        key: String,
        user: &str,
        password: &str,
    ) -> Result<Self, String> {
        let (mut ssh, _) = Self::connect(host, Some(key)).await?;
        let authenticated = timeout(
            Duration::from_secs(20),
            ssh.0.authenticate_password(user, password),
        )
        .await
        .map_err(|_| "SSH authentication timed out.")?
        .map_err(|_| "SSH authentication failed.")?;
        if !authenticated.success() {
            return Err("SSH authentication failed. Check the username and password.".into());
        }
        Ok(ssh)
    }

    pub async fn execute(
        &self,
        command: &str,
        input: &[u8],
        seconds: u64,
        mut output: impl FnMut(&[u8]),
    ) -> Result<u32, String> {
        timeout(Duration::from_secs(seconds), async {
            let channel = self
                .0
                .channel_open_session()
                .await
                .map_err(|_| "Could not open the SSH command channel.")?;
            channel
                .exec(true, command)
                .await
                .map_err(|_| "The server refused the setup command.")?;
            let (mut reader, writer) = channel.split();
            let send = async {
                writer
                    .data(input)
                    .await
                    .map_err(|_| "Could not upload the setup data.")?;
                writer
                    .eof()
                    .await
                    .map_err(|_| "Could not finish uploading setup data.")?;
                Ok::<_, String>(())
            };
            let receive = async {
                let mut code = None;
                while let Some(message) = reader.wait().await {
                    match message {
                        ChannelMsg::Data { data } => output(&data),
                        ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                        _ => {}
                    }
                }
                code.ok_or_else(|| {
                    "The SSH command ended without a result. Retry with the same details.".into()
                })
            };
            let (_, code) = tokio::try_join!(send, receive)?;
            Ok(code)
        })
        .await
        .map_err(|_| "The server step timed out. Retry with the same setup details.".to_owned())?
    }
}
