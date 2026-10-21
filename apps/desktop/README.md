# Noted desktop

The Windows client bundles the shared React app, connects to an existing Noted server, and can install a new server over SSH. Notes and files stay on that server. No local notes database or object storage service is installed.

## Build on Windows

Install Node.js, Rust 1.94 or newer with the MSVC toolchain, Visual Studio C++ build tools, and the WebView2 runtime. The installer can download the WebView2 bootstrapper when the runtime is missing.

From the repository root:

```powershell
npm --prefix apps/web ci
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
```

The build produces:

- `apps/desktop/src-tauri/target/release/noted-desktop.exe`
- `apps/desktop/src-tauri/target/release/bundle/nsis/Noted_0.2.3_x64-setup.exe`

The installer is per-user and does not have a Windows Authenticode certificate. It does not install a server, Docker, or a database on the PC. The project has separate lockfiles for the frontend, desktop CLI, and Rust dependencies. Generated native artifacts and frontend bundles are ignored by Git and Docker build contexts.

## App updates

On Windows, Settings > Desktop app checks the official published releases. The app also checks shortly after startup and every 24 hours while running. Downloads show progress and verify a signature tied to the announced version. Restart and install requires confirmation. The server's update controls are independent.

The first installer containing this feature must be installed manually. Later updates can be downloaded and installed inside Noted. Failed checks or downloads leave the current app running.

Signed update builds use `python scripts/desktop.py build` with the backend Python environment. CI caches Rust dependencies, and publishing signs the installer produced by its Windows checks without compiling it again. The updater key is separate from Windows Authenticode signing. Its public half is pinned in the app configuration; its private half stays outside the repository. Publishing requires the `TAURI_SIGNING_PRIVATE_KEY` Actions secret. Signing and publishing both verify the installer signature before it becomes a release download.

## Connect

Open Noted and enter the existing server's HTTPS origin, such as `https://notes.example.com`. Native requests verify HTTPS certificates. HTTP is accepted only for localhost development. After the readiness and API-version check, sign in using the server's username and password.

Only the server URL and a preferred local port are saved in `connection.json` under the application's configuration directory. On Windows, **Keep me signed in** stores the session token and its expiry in Windows Credential Manager so sign-in survives app restarts. The password is never saved. Without that option, session cookies stay in native process memory. Server session cookies are never written to the connection file, returned to JavaScript, or stored in localStorage. Saved sessions still expire or can be revoked from Settings > Sessions.

Use Settings > Connection > Switch server to forget the current address. The sign-in and connection-error screens also provide Switch server. Forgetting the connection clears its saved sign-in and discards its native cookie jar; it does not revoke the server-side session, which can still be revoked under Sessions or expire normally. Signing out also clears the saved sign-in.

The shared UI is compiled into the executable. A protected HTTP gateway binds only to `127.0.0.1`, serves those bundled assets, and forwards fixed `/api/` requests to the selected server. Per-launch private cookies, Host/Origin checks, fetch metadata checks, and CSRF tokens protect the local gateway. Native requests replace browser-supplied credentials and use the server's own origin/CSRF cookies. Uploads, downloads, and video byte ranges stream through this gateway. No frontend IPC capabilities or general shell commands are exposed. External HTTP(S) links open in the system browser.

## Set up a VPS

Choose **Set up a new server** on the connection screen. This version supports root password authentication on x86_64 Ubuntu 24.04/26.04 and Debian 12/13 VPSs with systemd, at least 2 GiB free disk space, and available TCP ports 80/443. It keeps existing Docker installations and unrelated services. Existing Docker must be running with its Compose plugin installed.

Already installed Python/OpenSSH helpers are reused. Package operations use needrestart's documented list-only mode to avoid automatic restarts of unrelated daemons. See [needrestart's environment options](https://manpages.debian.org/trixie/needrestart/needrestart.1.en.html#ENVIRONMENT).

Enter the server name, IP, SSH port, root password, domain, and owner username/password. Set the public release repository, defaulting to `kotm8/noted`. The client inspects the SSH host key without sending a password. Compare the displayed SHA256 fingerprint against your provider or server console and confirm it before installation.

The GitHub Release must provide `noted-release.json` and `noted-deploy.tar.gz`, with publicly pullable backend/web GHCR images. No GitHub token is embedded or required. The client checks API/configuration/worker compatibility, pins the reviewed commit and manifest checksum, verifies the deployment archive, and rejects unsafe archive members. Missing or changed releases stop before VPS changes.

Small worker/install scripts are compiled into the native app by `build.rs`. The client uploads them and the verified deployment files over SSH. The VPS installs Docker from its official package repository if missing, pulls prebuilt images by digest, generates database/instance secrets, starts Compose with migrations and readiness checks, provisions the owner through stdin, and enables daily update checks. The PC needs neither Docker nor Python for setup.

DNS changes stay manual. Point the domain to the VPS and keep Cloudflare on **DNS only** for large attachments. **Check connection and open Noted** verifies HTTPS, readiness, API compatibility, and the installed build commit before remembering the server. DNS delays leave setup at this step without repeating SSH provisioning.

Only nonsecret setup details and progress are stored in `setup.json` beside the connection profile. Passwords stay in memory and travel through SSH, outside command arguments and progress logs. After interruption, retry with the same details and passwords. The VPS marker prevents replacing an unrelated installation; retries preserve database credentials. A completed installation checks the updater without restarting containers, and retrying after a server upgrade cannot downgrade it. No automatic cleanup deletes a partially installed server or its data.

The native code is split into `installer/models.rs`, `release.rs`, `ssh.rs`, `worker.rs`, and the local endpoint/state module. Server provisioning lives in `updater/noted_updater/install.py` and `resources/prepare-desktop.sh`.

Implementation references: [Tauri resources](https://v2.tauri.app/develop/resources/), [Russh client API](https://docs.rs/russh/0.64.1/russh/client/), [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [Docker Debian installation](https://docs.docker.com/engine/install/debian/), [image digests](https://docs.docker.com/reference/cli/docker/image/pull/), [Compose readiness](https://docs.docker.com/reference/cli/docker/compose/up/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), and [Cloudflare subdomains](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/).

## Verification

Build and run the native unit tests:

```powershell
npm --prefix apps/desktop run build:debug
npm --prefix apps/desktop test
python scripts/dev.py test-desktop
python scripts/test_desktop_ssh.py --app
```

The desktop workflow launches the real executable and controls its WebView2 window. It uses a temporary PostgreSQL schema, temporary server files, an isolated desktop profile, and a temporary download directory. It verifies connection validation, sign-in, native-only server cookies, gateway CSRF checks, note persistence, file upload/download, video playback/ranges, a downloaded ZIP's contents, app restart, and switching servers. It closes its own processes and removes its test data afterward. Debug inspection and test-path overrides are unavailable in the release build.

The SSH fixture uses a disposable local container with no VPS credentials. It covers native SSH host-key pinning, password rejection, five MiB bidirectional streaming, timeouts, occupied ports, and existing-installation preservation. With `--app`, it also opens the real WebView2 wizard and checks the missing-release path. Its review screenshot uses fixture release metadata. Python tests cover provisioning retries and real PostgreSQL owner creation/retry without replacing a password.

Installation from a published release on a clean systemd VPS and real DNS/certificate issuance still need deployment verification after a release is published. SSH key/non-root provisioning, multiple saved profiles, and Linux/macOS packaging remain future work. The [Android client](../android/README.md) is a separate project in this repository.
