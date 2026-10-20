import argparse
import base64
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
SIGNING = ROOT / ".local/android/signing.json"
ASSOCIATION = ROOT / "apps/web/public/.well-known/assetlinks.json"


def environment() -> dict[str, str]:
    values = os.environ.copy()
    if os.name == "nt":
        jdk = Path("C:/Program Files/Android/openjdk")
        candidates = sorted(jdk.glob("jdk-*")) if jdk.is_dir() else []
        if not values.get("JAVA_HOME") and candidates:
            values["JAVA_HOME"] = str(candidates[-1])
        sdk = Path("C:/Program Files (x86)/Android/android-sdk")
        if not values.get("ANDROID_HOME") and sdk.is_dir():
            values["ANDROID_HOME"] = str(sdk)
    values.pop("DEBUG", None)
    return values


def keytool(values: dict[str, str]) -> str:
    name = "keytool.exe" if os.name == "nt" else "keytool"
    java_home = values.get("JAVA_HOME")
    executable = Path(java_home) / "bin" / name if java_home else None
    if executable and executable.is_file():
        return str(executable)
    located = shutil.which(name)
    if located:
        return located
    raise SystemExit("Install JDK 17 or 21 and set JAVA_HOME first.")


def signing_environment(values: dict[str, str]) -> dict[str, str]:
    if values.get("NOTED_ANDROID_KEYSTORE"):
        if not all(
            values.get(name)
            for name in ("NOTED_ANDROID_STORE_PASSWORD", "NOTED_ANDROID_KEY_PASSWORD")
        ):
            raise SystemExit("Supply the store and key passwords with the signing keystore.")
        values.setdefault("NOTED_ANDROID_KEY_ALIAS", "noted")
        return values
    SIGNING.parent.mkdir(parents=True, exist_ok=True)
    if SIGNING.is_file():
        config = json.loads(SIGNING.read_text(encoding="utf-8"))
    else:
        path = SIGNING.parent / "noted-release.jks"
        if path.exists():
            raise SystemExit(
                "A signing key already exists without signing.json. Restore its configuration."
            )
        password = secrets.token_urlsafe(48)
        config = {"keystore": str(path), "alias": "noted", "password": password}
        temporary = {**values, "NOTED_NEW_KEY_PASSWORD": password}
        subprocess.run(
            [
                keytool(values),
                "-genkeypair",
                "-keystore",
                str(path),
                "-alias",
                "noted",
                "-keyalg",
                "RSA",
                "-keysize",
                "3072",
                "-validity",
                "10000",
                "-dname",
                "CN=Noted",
                "-storepass:env",
                "NOTED_NEW_KEY_PASSWORD",
                "-keypass:env",
                "NOTED_NEW_KEY_PASSWORD",
            ],
            env=temporary,
            check=True,
            capture_output=True,
        )
        with SIGNING.open("x", encoding="utf-8") as file:
            json.dump(config, file)
        SIGNING.chmod(0o600)
    if not Path(config["keystore"]).is_file():
        raise SystemExit(
            "The existing release signing key is missing. Restore it to keep updates compatible."
        )
    return {
        **values,
        "NOTED_ANDROID_KEYSTORE": config["keystore"],
        "NOTED_ANDROID_KEY_ALIAS": config["alias"],
        "NOTED_ANDROID_STORE_PASSWORD": config["password"],
        "NOTED_ANDROID_KEY_PASSWORD": config["password"],
    }


def export_association(values: dict[str, str]) -> None:
    certificate = subprocess.run(
        [
            keytool(values),
            "-exportcert",
            "-keystore",
            values["NOTED_ANDROID_KEYSTORE"],
            "-alias",
            values["NOTED_ANDROID_KEY_ALIAS"],
            "-storepass:env",
            "NOTED_ANDROID_STORE_PASSWORD",
        ],
        env=values,
        check=True,
        capture_output=True,
    ).stdout
    digest = hashlib.sha256(certificate).hexdigest().upper()
    fingerprint = ":".join(digest[index : index + 2] for index in range(0, len(digest), 2))
    statement = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": "com.noted.android",
                "sha256_cert_fingerprints": [fingerprint],
            },
        }
    ]
    ASSOCIATION.parent.mkdir(parents=True, exist_ok=True)
    ASSOCIATION.write_text(json.dumps(statement, indent=2) + "\n", encoding="utf-8")
    print(
        "Updated the public app/domain verification file. No private signing material is exported.",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the signed Noted APK and its public domain association."
    )
    parser.add_argument(
        "command",
        choices=["build", "check", "github-secrets"],
        default="build",
        nargs="?",
    )
    args = parser.parse_args()
    values = environment()
    if args.command == "github-secrets":
        values = signing_environment(values)
        if values["NOTED_ANDROID_KEY_ALIAS"] != "noted" or (
            values["NOTED_ANDROID_KEY_PASSWORD"] != values["NOTED_ANDROID_STORE_PASSWORD"]
        ):
            raise SystemExit(
                "The GitHub workflow expects alias noted and matching key/store passwords."
            )
        directory = ROOT / ".local/github-secrets"
        directory.mkdir(parents=True, exist_ok=True)
        secrets_to_save = {
            "ANDROID_SIGNING_KEYSTORE": base64.b64encode(
                Path(values["NOTED_ANDROID_KEYSTORE"]).read_bytes()
            ).decode(),
            "ANDROID_SIGNING_PASSWORD": values["NOTED_ANDROID_STORE_PASSWORD"],
        }
        for name, value in secrets_to_save.items():
            path = directory / f"{name}.txt"
            path.write_text(value, encoding="utf-8")
            path.chmod(0o600)
        print(f"Prepared the two private Actions secret values in {directory}.")
        return
    wrapper = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    tasks = [
        ":app:assembleDebug",
        ":app:testDebugUnitTest",
        ":app:lintDebug",
        ":app:assembleDebugAndroidTest",
        ":wear:assembleDebug",
        ":wear:testDebugUnitTest",
        ":wear:lintDebug",
        ":watchface:assembleDebug",
    ]
    if args.command == "build":
        values = signing_environment(values)
        export_association(values)
        tasks.insert(0, ":app:assembleRelease")
        tasks.insert(0, ":wear:assembleRelease")
        tasks.insert(0, ":watchface:assembleRelease")
    subprocess.run([str(wrapper), "--console=plain", *tasks], cwd=ANDROID, env=values, check=True)
    variants = ["debug", "release"] if args.command == "build" else ["debug"]
    for variant in variants:
        face_apk = ANDROID / f"watchface/build/outputs/apk/{variant}/watchface-{variant}.apk"
        with zipfile.ZipFile(face_apk) as archive:
            if any(name.endswith(".dex") for name in archive.namelist()):
                raise SystemExit("The Watch Face Format APK must contain resources only.")
        watch_apk = ANDROID / f"wear/build/outputs/apk/{variant}/wear-{variant}.apk"
        with zipfile.ZipFile(watch_apk) as archive:
            if archive.read("assets/watchface/noted.apk") != face_apk.read_bytes():
                raise SystemExit("The watch APK does not contain the current watch face.")
            if not archive.read("assets/watchface/validation-token.txt").strip():
                raise SystemExit("The bundled watch face has no validation token.")
    if args.command == "build":
        print(f"APK: {ANDROID / 'app/build/outputs/apk/release/app-release.apk'}")
        print(f"Watch APK: {ANDROID / 'wear/build/outputs/apk/release/wear-release.apk'}")
        print("The watch face is included in the watch APK.")
        print(
            "Keep .local/android/signing.json and its keystore private and backed up "
            "for future updates."
        )


if __name__ == "__main__":
    main()
