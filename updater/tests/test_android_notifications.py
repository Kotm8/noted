import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.android_notifications import parse_configuration
from noted_updater.docker import OperationError


def fixture():
    return {
        "googleServicesJson": json.dumps(
            {
                "project_info": {"project_id": "noted-fixture", "project_number": "1234567890"},
                "client": [
                    {
                        "client_info": {
                            "mobilesdk_app_id": "1:1234567890:android:abcdef",
                            "android_client_info": {"package_name": "com.noted.android"},
                        },
                        "api_key": [{"current_key": "AIza" + "a" * 35}],
                    }
                ],
            }
        ),
        "serviceAccountJson": json.dumps(
            {
                "type": "service_account",
                "project_id": "noted-fixture",
                "client_email": "firebase-adminsdk-test@noted-fixture.iam.gserviceaccount.com",
                "private_key": (
                    "-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----\n"
                ),
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        ),
    }


class AndroidConfigurationTests(unittest.TestCase):
    def test_optional_setup_and_public_fields_are_separated_from_the_private_key(self):
        self.assertIsNone(parse_configuration(None))
        value = parse_configuration(fixture())
        self.assertEqual(value["client"]["package_name"], "com.noted.android")
        self.assertNotIn("private_key", json.dumps(value["client"]))
        self.assertIn("private_key", value["service_account"])

    def test_rejects_mismatched_projects_packages_and_external_credential_endpoints(self):
        for field, old, new in [
            ("serviceAccountJson", "noted-fixture", "other-project"),
            ("googleServicesJson", "com.noted.android", "another.app"),
            ("googleServicesJson", "1:1234567890:", "1:999:"),
            (
                "serviceAccountJson",
                "https://oauth2.googleapis.com/token",
                "https://example.com/token",
            ),
        ]:
            data = fixture()
            data[field] = data[field].replace(old, new)
            with self.subTest(field=field, new=new), self.assertRaises(OperationError):
                parse_configuration(data)
        for value in [[], {}, {**fixture(), "serviceAccountJson": "x" * 32769}]:
            with self.assertRaises(OperationError):
                parse_configuration(value)

if __name__ == "__main__":
    unittest.main()
