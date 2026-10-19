use super::Installer;

#[derive(Default)]
pub struct Progress {
    pending: Vec<u8>,
    oversized: bool,
}

impl Progress {
    pub fn receive(&mut self, chunk: &[u8], installer: &Installer) {
        for byte in chunk {
            if *byte == b'\n' {
                if !self.oversized {
                    if let Some((phase, detail)) = event(&self.pending) {
                        installer.update(phase, detail, "running");
                    }
                }
                self.pending.clear();
                self.oversized = false;
            } else if self.pending.len() < 4096 && !self.oversized {
                self.pending.push(*byte);
            } else {
                self.pending.clear();
                self.oversized = true;
            }
        }
    }
}

fn event(line: &[u8]) -> Option<(&'static str, &'static str)> {
    let raw = line.strip_prefix(b"NOTED_SETUP ")?;
    let value: serde_json::Value = serde_json::from_slice(raw).ok()?;
    match value["phase"].as_str()? {
        "images" => Some((
            "images",
            "Downloading the published server images on the VPS.",
        )),
        "starting" => Some((
            "starting",
            "Starting PostgreSQL, applying migrations, and starting Noted.",
        )),
        "owner" => Some(("owner", "Creating your owner account.")),
        "android_notifications" => Some((
            "android_notifications",
            "Saving Firebase configuration privately on your VPS.",
        )),
        "updater" => Some((
            "updater",
            "Enabling daily update checks and click-to-install upgrades.",
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmented_progress_discards_raw_output_and_never_persists_remote_details() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("setup.json");
        let installer = Installer::new(path.clone());
        let mut progress = Progress::default();
        progress.receive(b"raw secret\nNOTED_SE", &installer);
        assert!(!path.exists());
        progress.receive(
            b"TUP {\"phase\":\"owner\",\"detail\":\"secret-password\"}\n",
            &installer,
        );
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(saved.contains("Creating your owner account"));
        assert!(!saved.contains("secret-password"));
        progress.receive(&vec![b'x'; 8192], &installer);
        progress.receive(b"\nNOTED_SETUP {\"phase\":\"updater\"}\n", &installer);
        assert_eq!(installer.job.lock().unwrap().phase, "updater");
    }
}
