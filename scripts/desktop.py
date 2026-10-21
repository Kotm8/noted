import argparse
import base64
import binascii
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "apps/desktop"
KEY = ROOT / ".local/desktop/updater.key"
CONFIG = DESKTOP / "src-tauri/tauri.conf.json"
sys.path.insert(0, str(ROOT))


def tauri(*arguments: str, environment: dict[str, str] | None = None) -> None:
    node = shutil.which("node")
    if not node:
        raise SystemExit("Install Node.js first.")
    subprocess.run(
        [node, str(DESKTOP / "node_modules/@tauri-apps/cli/tauri.js"), *arguments],
        cwd=DESKTOP,
        env=environment,
        check=True,
    )


def initialize() -> None:
    if KEY.exists():
        raise SystemExit("An updater key already exists. Keeping it unchanged.")
    config = json.loads(CONFIG.read_text())
    updater = config.setdefault("plugins", {}).setdefault("updater", {})
    if updater.get("pubkey"):
        raise SystemExit("The app already pins an updater key. Restore its matching private key.")
    KEY.parent.mkdir(parents=True, exist_ok=True)
    node = shutil.which("node")
    if not node:
        raise SystemExit("Install Node.js first.")
    subprocess.run(
        [
            node,
            str(DESKTOP / "node_modules/@tauri-apps/cli/tauri.js"),
            "signer",
            "generate",
            "--ci",
            "--write-keys",
            str(KEY),
        ],
        cwd=DESKTOP,
        check=True,
        capture_output=True,
    )
    KEY.chmod(0o600)
    updater.update(
        pubkey=KEY.with_suffix(".key.pub").read_text().strip(),
        endpoints=[
            "https://github.com/kotm8/noted/releases/latest/download/noted-desktop-update.json"
        ],
        requireSignedVersion=True,
        windows={"installMode": "passive"},
    )
    CONFIG.write_text(json.dumps(config, indent=2) + "\n")
    print("Created the private desktop updater key and configured its public verification key.")


def signing_environment() -> dict[str, str]:
    environment = os.environ.copy()
    value = environment.get("TAURI_SIGNING_PRIVATE_KEY", "").strip()
    if not value:
        if not KEY.is_file():
            raise SystemExit("Run python scripts/desktop.py signing-key first.")
        value = KEY.read_text()
    else:
        try:
            key_path = Path(value)
            if key_path.is_file():
                value = key_path.read_text()
        except OSError:
            pass
    value = "".join(value.split())
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise SystemExit(
            "TAURI_SIGNING_PRIVATE_KEY must contain the generated updater key."
        ) from None
    if not decoded.startswith(b"untrusted comment:"):
        raise SystemExit("TAURI_SIGNING_PRIVATE_KEY must contain the generated updater key.")
    environment["TAURI_SIGNING_PRIVATE_KEY"] = value
    environment.setdefault("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
    return environment


def verify_installer(installer: Path, version: str) -> None:
    from scripts.desktop_update import public_key, verify_signature

    verify_signature(
        installer.read_bytes(),
        installer.with_suffix(".exe.sig").read_text().strip(),
        public_key(),
        version,
    )
    print("The Windows installer signature and release version are verified.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build signed Noted desktop updates.")
    parser.add_argument("command", choices=["build", "sign", "signing-key", "github-secret"])
    parser.add_argument("--installer", type=Path)
    arguments = parser.parse_args()
    command = arguments.command
    if command == "signing-key":
        initialize()
    elif command == "github-secret":
        if not KEY.is_file():
            raise SystemExit("The private desktop updater key is missing.")
        target = ROOT / ".local/github-secrets/TAURI_SIGNING_PRIVATE_KEY.txt"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("".join(KEY.read_text().split()))
        target.chmod(0o600)
        print(f"Prepared the private Actions secret in {target}.")
    elif command == "sign":
        version = json.loads(CONFIG.read_text())["version"]
        installer = arguments.installer
        if installer is None or installer.name != f"Noted_{version}_x64-setup.exe":
            parser.error("Provide --installer with the current version's Windows installer.")
        installer = installer.resolve(strict=True)
        tauri(
            "signer",
            "sign",
            "--app-version",
            version,
            str(installer),
            environment=signing_environment(),
        )
        verify_installer(installer, version)
    else:
        tauri(
            "build",
            "--config",
            json.dumps({"bundle": {"createUpdaterArtifacts": True}}),
            environment=signing_environment(),
        )
        version = json.loads(CONFIG.read_text())["version"]
        installer = DESKTOP / f"src-tauri/target/release/bundle/nsis/Noted_{version}_x64-setup.exe"
        verify_installer(installer, version)


if __name__ == "__main__":
    main()
