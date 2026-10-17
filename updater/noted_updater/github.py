import hashlib
import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .release import Manifest, Release


def trusted_url(url: str) -> bool:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    return (
        parsed.scheme == "https"
        and not parsed.username
        and not parsed.password
        and parsed.port in {None, 443}
        and (host in {"api.github.com", "github.com"} or host.endswith(".githubusercontent.com"))
    )


class GitHubRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not trusted_url(newurl):
            raise ValueError("Unexpected release download destination")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and urlsplit(newurl).hostname != urlsplit(req.full_url).hostname:
            redirected.remove_header("Authorization")
        return redirected


class GitHubSource:
    def __init__(self, repository: str, token: str | None = None):
        self.repository = repository
        self.token = token
        self.opener = build_opener(GitHubRedirects())

    def download(self, url: str, maximum: int, binary: bool = True) -> bytes:
        if not trusted_url(url):
            raise ValueError("Untrusted release URL")
        headers = {
            "User-Agent": "Noted-server-updater",
            "Accept": "application/octet-stream" if binary else "application/vnd.github+json",
        }
        if self.token and urlsplit(url).hostname == "api.github.com":
            headers["Authorization"] = f"Bearer {self.token}"
        with self.opener.open(Request(url, headers=headers), timeout=30) as response:
            raw = response.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError("Release metadata exceeds its size limit")
        return raw

    def latest(self) -> Release | None:
        try:
            raw = self.download(
                f"https://api.github.com/repos/{self.repository}/releases/latest", 1048576, False
            )
        except HTTPError as error:
            if error.code == 404:
                self.download(f"https://api.github.com/repos/{self.repository}", 1048576, False)
                return None
            raise
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("draft") or data.get("prerelease"):
            raise ValueError("Expected a published main release")
        assets = {asset["name"]: asset for asset in data.get("assets", [])}
        manifest_asset = assets["noted-release.json"]
        bundle_asset = assets["noted-deploy.tar.gz"]
        for asset in (manifest_asset, bundle_asset):
            if (
                not str(asset.get("url", ""))
                .lower()
                .startswith(f"https://api.github.com/repos/{self.repository}/releases/assets/")
            ):
                raise ValueError("Release asset belongs to another repository")
        manifest_raw = self.download(manifest_asset["url"], 65536)
        manifest = Manifest.parse(json.loads(manifest_raw), self.repository)
        if data.get("tag_name") != f"main-{manifest.commit}":
            raise ValueError("Release tag and manifest do not agree")
        return Release(
            manifest,
            hashlib.sha256(manifest_raw).hexdigest(),
            bundle_asset["url"],
            f"https://github.com/{self.repository}/releases/tag/main-{manifest.commit}",
            str(data.get("body") or ""),
            str(data.get("published_at") or ""),
        )

    def bundle(self, release: Release) -> bytes:
        return self.download(release.bundle_url, 2097152)
