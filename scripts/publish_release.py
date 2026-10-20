import argparse
import hashlib
import io
import json
import os
import sys
import tarfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def api(
    path: str,
    data: dict | bytes | None = None,
    method: str = "GET",
    content_type: str = "application/json",
) -> dict:
    headers = {
        "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "Noted-release-publisher",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        headers["Content-Type"] = content_type
    with urlopen(Request(path, data=body, method=method, headers=headers), timeout=120) as response:
        return {} if response.status == 204 else json.load(response)


def main() -> None:
    from scripts.release_notes import release_notes
    from scripts.release_version import release_version

    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-metadata", type=Path, required=True)
    parser.add_argument("--web-metadata", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--clients-directory", type=Path)
    arguments = parser.parse_args()
    if arguments.version != release_version():
        raise SystemExit("Release version must match the version in the app project files.")
    try:
        notes = release_notes(arguments.version)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    repository = os.environ["GITHUB_REPOSITORY"].lower()
    commit = os.environ["GITHUB_SHA"]
    tag = f"main-{commit}"
    assets = release_assets(arguments, repository, commit)
    if (
        api(f"https://api.github.com/repos/{repository}/git/ref/heads/main")["object"]["sha"]
        != commit
    ):
        raise SystemExit("Main advanced. Run Publish release again from the current main commit.")
    api_base = f"https://api.github.com/repos/{repository}/releases"
    try:
        existing = api(f"{api_base}/tags/{tag}")
        if not existing["draft"]:
            print("This commit already has a published immutable release. Nothing to replace.")
            return
        release = existing
    except HTTPError as error:
        if error.code != 404:
            raise
        error.close()
        release = api(
            api_base,
            {
                "tag_name": tag,
                "target_commitish": commit,
                "name": f"v{arguments.version}",
                "body": notes,
                "draft": True,
                "prerelease": False,
            },
            "POST",
        )
    existing_assets = {asset["name"]: asset["id"] for asset in release.get("assets", [])}
    for name, body in assets.items():
        if name in existing_assets:
            api(f"{api_base}/assets/{existing_assets[name]}", method="DELETE")
        api(
            f"https://uploads.github.com/repos/{repository}/releases/{release['id']}/assets"
            f"?{urlencode({'name': name})}",
            body,
            "POST",
            "application/octet-stream",
        )
    if (
        api(f"https://api.github.com/repos/{repository}/git/ref/heads/main")["object"]["sha"]
        != commit
    ):
        raise SystemExit("Main advanced during publishing. Release kept as a draft; run again.")
    api(
        f"{api_base}/{release['id']}",
        {
            "name": f"v{arguments.version}",
            "body": notes,
            "draft": False,
            "make_latest": "true",
        },
        "PATCH",
    )
    url = f"https://github.com/{repository}/releases/tag/{tag}"
    print(f"Published v{arguments.version}: {url}")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as output:
            output.write(
                f"Published [Noted v{arguments.version}]({url}) with server and client downloads.\n"
            )


def release_assets(arguments: argparse.Namespace, repository: str, commit: str) -> dict[str, bytes]:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for filename in ("compose.production.yaml", "Caddyfile.production"):
            archive.add(ROOT / "deploy" / filename, arcname=filename)
    bundle = buffer.getvalue()
    policy = json.loads((ROOT / "updater/release-policy.json").read_text())
    backend = json.loads(arguments.backend_metadata.read_text())["containerimage.digest"]
    web = json.loads(arguments.web_metadata.read_text())["containerimage.digest"]
    sys.path.insert(0, str(ROOT / "backend"))
    from app.core.config import API_VERSION, SCHEMA_REVISION

    manifest = {
        **policy,
        "repository": repository,
        "channel": "main",
        "commit": commit,
        "sequence": time.time_ns() // 1000,
        "version": arguments.version,
        "schema_revision": SCHEMA_REVISION,
        "api_version": API_VERSION,
        "backend_image": f"ghcr.io/{repository}-backend@{backend}",
        "web_image": f"ghcr.io/{repository}-web@{web}",
        "bundle_sha256": hashlib.sha256(bundle).hexdigest(),
    }
    sys.path.insert(0, str(ROOT / "updater"))
    from noted_updater.release import Manifest

    Manifest.parse(manifest, repository)
    updater_buffer = io.BytesIO()
    with tarfile.open(fileobj=updater_buffer, mode="w:gz") as archive:
        package = ROOT / "updater/noted_updater"
        for file in sorted(package.rglob("*")):
            if file.is_file() and file.suffix in {".py", ".sh"}:
                archive.add(
                    file,
                    arcname=f"noted_updater/{file.relative_to(package).as_posix()}",
                )
        archive.add(ROOT / "deploy/install-updater.sh", arcname="install-updater.sh")
    assets = {
        "noted-release.json": json.dumps(manifest, indent=2).encode(),
        "noted-deploy.tar.gz": bundle,
        "noted-updater.tar.gz": updater_buffer.getvalue(),
    }
    if arguments.clients_directory is not None:
        clients = sorted(arguments.clients_directory.iterdir())
        suffixes = [path.suffix for path in clients]
        apk_names = {path.name.rsplit("_", 1)[-1] for path in clients if path.suffix == ".apk"}
        if (
            len(clients) not in {2, 3}
            or suffixes.count(".exe") != 1
            or suffixes.count(".apk") != len(clients) - 1
            or apk_names != ({"android.apk"} if len(clients) == 2 else {"android.apk", "wear.apk"})
        ):
            raise ValueError(
                "Release downloads require a Windows installer and either the phone APK "
                "or the phone and combined watch APKs"
            )
        for path in clients:
            if not path.is_file() or path.stat().st_size == 0:
                raise ValueError(f"Client download is empty or missing: {path.name}")
            assets[path.name] = path.read_bytes()
    assets["SHA256SUMS"] = "".join(
        f"{hashlib.sha256(body).hexdigest()}  {name}\n" for name, body in assets.items()
    ).encode()
    return assets


if __name__ == "__main__":
    main()
