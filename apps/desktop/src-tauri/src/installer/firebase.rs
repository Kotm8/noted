use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FirebaseSetup {
    pub google_services_json: String,
    pub service_account_json: String,
}

#[cfg(test)]
mod tests {
    use super::FirebaseSetup;
    use serde_json::json;

    fn fixture() -> FirebaseSetup {
        FirebaseSetup {
            google_services_json: json!({
                "project_info": {"project_id": "noted-fixture"},
                "client": [{"client_info": {"android_client_info": {"package_name": "com.noted.android"}}}]
            }).to_string(),
            service_account_json: json!({
                "type": "service_account", "project_id": "noted-fixture",
                "client_email": "firebase-adminsdk-test@noted-fixture.iam.gserviceaccount.com",
                "private_key": "-----BEGIN PRIVATE KEY-----\nsecret-fixture\n-----END PRIVATE KEY-----\n",
                "token_uri": "https://oauth2.googleapis.com/token"
            }).to_string(),
        }
    }

    #[test]
    fn validates_project_package_and_bounded_json_without_exposing_credentials() {
        let mut data = fixture();
        assert!(data.validate().is_ok());
        data.service_account_json = data
            .service_account_json
            .replace("noted-fixture", "other-project");
        assert!(data.validate().is_err());
        data = fixture();
        data.google_services_json = data
            .google_services_json
            .replace("com.noted.android", "another.app");
        assert!(data.validate().is_err());
        data.service_account_json = "secret-fixture".repeat(3000);
        let error = data.validate().unwrap_err();
        assert!(!error.contains("secret-fixture"));
    }
}

impl FirebaseSetup {
    pub fn validate(&self) -> Result<(), String> {
        if self.google_services_json.len() > 32768 || self.service_account_json.len() > 32768 {
            return Err("Each Firebase JSON file must be smaller than 32 KB.".into());
        }
        let client: serde_json::Value = serde_json::from_str(&self.google_services_json)
            .map_err(|_| "Check the complete google-services.json file.")?;
        let account: serde_json::Value = serde_json::from_str(&self.service_account_json)
            .map_err(|_| "Check the complete service-account JSON file.")?;
        let project = client["project_info"]["project_id"]
            .as_str()
            .filter(|value| super::models::matches(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$", value))
            .ok_or("The Android app JSON needs a valid Firebase project ID.")?;
        if account["project_id"] != project || account["type"] != "service_account" {
            return Err(
                "Use an Android app JSON and service-account JSON from the same Firebase project."
                    .into(),
            );
        }
        let has_app = client["client"].as_array().is_some_and(|clients| {
            clients.iter().any(|app| {
                app["client_info"]["android_client_info"]["package_name"] == "com.noted.android"
            })
        });
        if !has_app {
            return Err("Register the Android app as com.noted.android in Firebase.".into());
        }
        if account["token_uri"] != "https://oauth2.googleapis.com/token"
            || !account["private_key"].as_str().is_some_and(|key| {
                key.starts_with("-----BEGIN PRIVATE KEY-----\n")
                    && key.trim_end().ends_with("-----END PRIVATE KEY-----")
            })
            || !account["client_email"].as_str().is_some_and(|email| {
                email.ends_with(&format!("@{project}.iam.gserviceaccount.com"))
            })
        {
            return Err(
                "Download a complete private-key JSON from Firebase Service accounts.".into(),
            );
        }
        Ok(())
    }
}
