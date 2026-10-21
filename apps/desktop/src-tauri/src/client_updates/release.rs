use url::Url;

pub fn validate_download(url: &Url, version: &str) -> Result<(), String> {
    let prefix = "/kotm8/noted/releases/download/";
    let valid_path = url.path().strip_prefix(prefix).is_some_and(|path| {
        path.split_once('/').is_some_and(|(tag, filename)| {
            tag.strip_prefix("main-")
                .is_some_and(|sha| sha.len() == 40 && sha.bytes().all(|c| c.is_ascii_hexdigit()))
                && filename == format!("Noted_{version}_x64-setup.exe")
        })
    });
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !valid_path
    {
        return Err("The update does not refer to an official immutable Windows release.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_are_pinned_to_the_official_versioned_windows_download() {
        let address = format!(
            "https://github.com/kotm8/noted/releases/download/main-{}/Noted_0.2.2_x64-setup.exe",
            "a".repeat(40)
        );
        assert!(validate_download(&Url::parse(&address).unwrap(), "0.2.2").is_ok());
        for invalid in [
            address.replace("https:", "http:"),
            address.replace("github.com", "github.com.evil.example"),
            address.replace("kotm8/noted", "someone/noted"),
            address.replace(&format!("main-{}", "a".repeat(40)), "latest"),
            address.replace("0.2.2_x64", "0.2.1_x64"),
            address.replace("x64-setup.exe", "android.apk"),
            format!("{address}?download=1"),
            format!("{address}#other"),
        ] {
            assert!(validate_download(&Url::parse(&invalid).unwrap(), "0.2.2").is_err());
        }
    }
}
