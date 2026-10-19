use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SavedSession {
    pub session: String,
    pub csrf: String,
    pub expires_at: u64,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl SavedSession {
    fn valid(&self) -> bool {
        self.expires_at > now()
            && [&self.session, &self.csrf].iter().all(|value| {
                !value.is_empty()
                    && value.len() <= 512
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            })
    }
}

#[derive(Clone)]
pub struct SessionVault {
    target: String,
}

impl SessionVault {
    pub fn new(profile: &Path, url: &Url) -> Self {
        let namespace = format!(
            "{}\n{}",
            profile.display(),
            url.origin().ascii_serialization()
        );
        Self {
            target: format!("Noted/session/{:x}", Sha256::digest(namespace.as_bytes())),
        }
    }

    pub fn load(&self) -> io::Result<Option<SavedSession>> {
        let Some(bytes) = platform::read(&self.target)? else {
            return Ok(None);
        };
        match serde_json::from_slice::<SavedSession>(&bytes) {
            Ok(session) if session.valid() => Ok(Some(session)),
            _ => {
                self.clear()?;
                Ok(None)
            }
        }
    }

    pub fn save(&self, session: &SavedSession) -> io::Result<()> {
        if !session.valid() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid saved session",
            ));
        }
        platform::write(&self.target, &serde_json::to_vec(session)?)
    }

    pub fn clear(&self) -> io::Result<()> {
        platform::delete(&self.target)
    }
}

#[cfg(windows)]
mod platform {
    use std::{io, ptr};
    use windows_sys::Win32::{
        Foundation::ERROR_NOT_FOUND,
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    pub fn read(target: &str) -> io::Result<Option<Vec<u8>>> {
        let target = wide(target);
        let mut credential = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                Ok(None)
            } else {
                Err(error)
            };
        }
        let data = unsafe {
            let value = &*credential;
            let result = if value.CredentialBlobSize > 0
                && value.CredentialBlobSize <= 2000
                && !value.CredentialBlob.is_null()
            {
                Ok(std::slice::from_raw_parts(
                    value.CredentialBlob,
                    value.CredentialBlobSize as usize,
                )
                .to_vec())
            } else {
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid credential data",
                ))
            };
            CredFree(credential.cast());
            result
        }?;
        Ok(Some(data))
    }

    pub fn write(target: &str, data: &[u8]) -> io::Result<()> {
        if data.len() > 2000 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Credential too large",
            ));
        }
        let mut target = wide(target);
        let mut username = wide("Noted session");
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            UserName: username.as_mut_ptr(),
            CredentialBlobSize: data.len() as u32,
            CredentialBlob: data.as_ptr().cast_mut(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    pub fn delete(target: &str) -> io::Result<()> {
        let target = wide(target);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
            Ok(())
        } else {
            Err(error)
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::io;
    pub fn read(_: &str) -> io::Result<Option<Vec<u8>>> {
        Ok(None)
    }
    pub fn write(_: &str, _: &[u8]) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Secure session storage is unavailable",
        ))
    }
    pub fn delete(_: &str) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_scoped_to_the_profile_and_server_origin() {
        let one = SessionVault::new(
            Path::new("one"),
            &Url::parse("https://notes.example.com").unwrap(),
        );
        assert_ne!(
            one.target,
            SessionVault::new(
                Path::new("two"),
                &Url::parse("https://notes.example.com").unwrap()
            )
            .target
        );
        assert_ne!(
            one.target,
            SessionVault::new(
                Path::new("one"),
                &Url::parse("https://other.example.com").unwrap()
            )
            .target
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_store_survives_reopening_and_forgetting_removes_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let url = Url::parse("https://vault-test.invalid").unwrap();
        let vault = SessionVault::new(directory.path(), &url);
        let session = SavedSession {
            session: "test-session-only".into(),
            csrf: "test-csrf-only".into(),
            expires_at: now() + 60,
        };
        vault.save(&session).unwrap();
        let restored = SessionVault::new(directory.path(), &url)
            .load()
            .unwrap()
            .unwrap();
        vault.clear().unwrap();
        assert_eq!(restored.session, session.session);
        assert_eq!(restored.csrf, session.csrf);
        assert!(vault.load().unwrap().is_none());
        assert!(std::fs::read_dir(directory.path())
            .unwrap()
            .next()
            .is_none());
    }
}
