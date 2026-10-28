use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::process::Command;

pub const PACKAGE: &str = "com.noted.android";
/// A private adb server, so a different adb version (Android Studio's) is never restarted.
const SERVER_PORT: &str = "5157";

pub struct Adb(pub PathBuf);

#[derive(Clone, Debug, PartialEq)]
pub struct Listed {
    pub serial: String,
    /// "device" when usable; "unauthorized" until the phone's prompt is accepted.
    pub state: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Description {
    pub name: String,
    pub watch: bool,
    pub installed: Option<String>,
}

impl Adb {
    pub async fn run(&self, args: &[&str], seconds: u64) -> Result<String, String> {
        let mut command = Command::new(&self.0);
        command
            .args(args)
            .env("ANDROID_ADB_SERVER_PORT", SERVER_PORT)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up.
        let output = tokio::time::timeout(Duration::from_secs(seconds), command.output())
            .await
            .map_err(|_| "The device didn't respond in time.".to_string())?
            .map_err(|_| "Could not start Android's install tool.".to_string())?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if output.status.success() {
            Ok(text)
        } else {
            Err(text.trim().to_string())
        }
    }

    pub async fn devices(&self) -> Result<Vec<Listed>, String> {
        Ok(parse_devices(&self.run(&["devices"], 20).await?))
    }

    pub async fn pair(&self, address: &str, code: &str) -> Result<(), String> {
        let output = self
            .run(&["pair", address, code], 30)
            .await
            .unwrap_or_else(|error| error);
        if output.contains("Successfully paired") {
            Ok(())
        } else {
            Err(
                "Pairing failed. Check the address and code, and pair again with a new code."
                    .into(),
            )
        }
    }

    /// Wireless debugging announces each paired device over mDNS with its current port.
    pub async fn discover(
        &self,
        host: Option<&str>,
        name: Option<&str>,
    ) -> Option<(String, String)> {
        let output = self.run(&["mdns", "services"], 15).await.ok()?;
        output.lines().find_map(|line| {
            let mut parts = line.split_whitespace();
            let instance = parts.next()?;
            let service = parts.next()?;
            let address = parts.next()?;
            let found_host = address.rsplit_once(':')?.0;
            let wanted = name.is_some_and(|name| name == instance)
                || host.is_some_and(|host| host == found_host);
            (service.starts_with("_adb-tls-connect") && wanted)
                .then(|| (instance.to_string(), address.to_string()))
        })
    }

    pub async fn connect(&self, address: &str) -> Result<(), String> {
        let output = self
            .run(&["connect", address], 20)
            .await
            .unwrap_or_else(|error| error);
        if output.contains("connected to") {
            Ok(())
        } else {
            Err(output)
        }
    }

    pub async fn disconnect(&self, address: &str) {
        let _ = self.run(&["disconnect", address], 10).await;
    }

    pub async fn describe(&self, serial: &str) -> Result<Description, String> {
        let output = self
            .run(
                &[
                    "-s",
                    serial,
                    "shell",
                    &format!(
                        "settings get global device_name; getprop ro.product.model; getprop ro.build.characteristics; dumpsys package {PACKAGE} | grep -m1 versionName"
                    ),
                ],
                20,
            )
            .await?;
        Ok(parse_description(&output))
    }

    pub async fn install(&self, serial: &str, apk: &str) -> Result<(), String> {
        let output = self
            .run(&["-s", serial, "install", "-r", apk], 300)
            .await
            .unwrap_or_else(|error| error);
        if output.contains("Success") {
            Ok(())
        } else if output.contains("INSTALL_FAILED_VERSION_DOWNGRADE") {
            Err("The device has a newer Noted than your server. Update the server first, or uninstall Noted on the device.".into())
        } else if output.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
            Err("The Noted on the device was signed differently. Uninstall it on the device, then install again.".into())
        } else {
            Err(format!("The device refused the install: {}", output.trim()))
        }
    }
}

pub fn parse_devices(text: &str) -> Vec<Listed> {
    text.lines()
        .skip_while(|line| !line.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            Some(Listed {
                serial: parts.next()?.to_string(),
                state: parts.next()?.to_string(),
            })
        })
        .collect()
}

fn parse_description(text: &str) -> Description {
    // adb prints "* daemon ..." lines first whenever it has to start its server.
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("* "))
        .collect();
    let line = |index: usize| lines.get(index).copied().unwrap_or_default();
    let name = match line(0) {
        "" | "null" => line(1),
        name => name,
    };
    Description {
        name: if name.is_empty() {
            "Android device".into()
        } else {
            name.into()
        },
        watch: line(2).contains("watch"),
        installed: lines
            .iter()
            .find_map(|line| line.strip_prefix("versionName="))
            .map(str::to_string),
    }
}

/// USB serials are plain IDs; Wi-Fi ones are `host:port` or an mDNS instance name.
pub fn is_wireless(serial: &str) -> bool {
    serial.contains(':') || serial.contains("._adb-tls-connect")
}
