# Noted

A self-hosted notes app where writing a note feels like sending a chat message.

The current implementation has a React browser interface, a FastAPI backend, and PostgreSQL persistence. The backend groups schemas, models, repositories, and services into `auth`, `workspaces`, `notes`, `reminders`, `notifications`, `backup`, `search`, and `server` modules, with HTTP endpoints kept together under `backend/app/api`.

The product is **hosted only**: a VPS, your domain, and an owner username/password account that works across devices. There is no local/offline notes mode. The commands below run development and verification environments. See [desktop server setup](apps/desktop/README.md#set-up-a-vps) for deployment and DNS instructions.

The Windows desktop client lives in `apps/desktop` and bundles the shared React interface. It connects to an existing Noted server or sets up a new VPS over SSH using a published release. Build it with `npm --prefix apps/desktop ci` and `npm --prefix apps/desktop run build` after installing the web dependencies. See [desktop build and testing](apps/desktop/README.md) for prerequisites, output paths, authentication behavior, SSH setup, and the native WebView2 smoke tests.

The web app supports reminder channels, `/remind` commands, reusable date/time controls, repeating reminders, Done and Snooze, and browser Web Push. See [phone notifications](apps/android/README.md#for-server-owners-and-phone-users) for setup and delivery requirements.

The Android client lives in `apps/android`. It opens your hosted interface as a Trusted Web Activity, with Chrome handling files, video, and Web Push notifications. Each VPS creates its own push keys automatically. No Firebase project or relay is required. See [Android build and installation](apps/android/README.md).

## Run locally for development

Requires Docker, Node.js 24 or newer, Python 3.13 or 3.14, and uv. Start Docker before running these commands.

From the project root:

```powershell
python scripts/dev.py init
python scripts/dev.py db
cd backend
uv sync --locked
cd ..
python scripts/dev.py migrate
python scripts/dev.py create-owner
```

Create the owner username/password account in the terminal. An optional username defaults to `owner`. Run the backend in one terminal:

```powershell
python scripts/dev.py api
```

Run the frontend in a second terminal:

```powershell
cd apps/web
npm ci
npm run dev
```

Open **http://localhost:5173** and sign in with the username and password chosen above. There are no default credentials, public registration, or preloaded notes. Create a workspace, a category if you want one, and a channel to begin writing. The desktop setup preview is at **http://localhost:5173/setup-preview** in development only.

Owner creation happens through trusted server-side provisioning and cannot replace an existing account. Session cookies are HTTP-only, CSRF protection is required for writes, and authentication attempts are rate limited.

The development database is published only on `127.0.0.1:55432`. Its data lives in a Docker volume. Generated local credentials live in `.local/compose.env`; keep that file private.

## Run the containerized local stack

This is an alternative to the development servers:

```powershell
python scripts/dev.py init
python scripts/dev.py up
```

For a fresh database, create the owner account:

```powershell
docker compose --env-file .local/compose.env -f deploy/compose.yaml exec backend python -m app.cli create-owner
```

Open **http://localhost:8080**. If you already created an owner with the development setup, sign in with the same credentials. Both development launch methods use the same persistent database volume.

The local stack builds the web assets and backend, runs migrations once, and serves the app through Caddy. PostgreSQL and the backend have no published ports in the base Compose file. Switching between development and the full container stack may recreate containers to change their port mappings. Stop the standalone development API and frontend before starting the full stack.

```powershell
python scripts/dev.py stop
```

Stopping services keeps their data. This configuration binds to localhost and is for development. Use the [desktop setup wizard](apps/desktop/README.md#set-up-a-vps) to deploy a published release to a VPS.

## Checks

Start the development database, then run backend integration tests from the project root:

```powershell
python scripts/dev.py db
python scripts/dev.py test
```

Tests apply real Alembic migrations in randomly named PostgreSQL schemas and remove those schemas afterward. They do not reset your notes or create a development owner.

Backend lint and type checks:

```powershell
cd backend
uv run ruff check app tests alembic ../scripts
uv run ruff format --check app tests alembic ../scripts
uv run mypy app
```

Frontend checks:

```powershell
cd apps/web
npm run lint
npm run typecheck
npm test
npm run build
```

The browser test exercises owner setup, navigation, Markdown, editing, deletion, file uploads and downloads, workspace images, search, appearance persistence, mobile layouts, and signing back in. It runs against a temporary PostgreSQL schema and attachment directory and starts its own API and frontend on ports 8000 and 5173. Keep those ports free.

On Windows with Chrome installed:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
python scripts/dev.py test-browser
```

Alternatively, install Playwright Chromium in the project cache before running the browser test:

```powershell
cd apps/web
$env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path (Resolve-Path ../..) '.local/browsers')
npx playwright install chromium
cd ../..
python scripts/dev.py test-browser
```

## Scope

Implemented source includes secure owner setup and sessions, workspace/category/channel management, raw Markdown notes, code highlighting and copying, message editing and deletion, bidirectional cursor pagination, persisted navigation, local drafts, file attachments, image/GIF workspace icons, indexed text search, account appearance settings, owner password changes, health/readiness/version endpoints, migrations, and local Compose configuration.

Use the **workspace dropdown** to create channels or categories, the composer **+** to attach files, and the header magnifying glass to open search inside a right sidebar. Bottom-left **Settings** contains appearance, server details, password changes, active sessions, and sign-out. Appearance is saved to your account and shared across devices. Message layouts are Minute markers (default), Connected thoughts, Quiet timestamp gutter, and Compact rows. Sessions can be signed out individually. Workspace creation/editing includes an emoji picker and image/GIF import, with square stretching and 512 by 512 resizing that preserves animation. The instance remains private and owner-only; invitations are deferred.

**Settings > Backups** exports and imports portable ZIPs containing content and files, with credentials/configuration excluded. **Settings > Server** adds automatic SSH VPS transfer, a separate domain switch, and a prominent **Danger Zone** requiring the exact phrase `I LOVE VERITY` plus the owner password before removing Noted and its data. Hosting controls require version 2 of the VPS worker. DNS changes remain manual.

Files use a persistent filesystem volume with PostgreSQL metadata and a streaming storage interface. Videos have an inline player with seeking, volume, fullscreen, mobile playback, and original downloads. MP4/M4V, WebM, and modern MOV containers are recognized; codec support depends on the browser. Older video attachments work without re-uploading. Development files are stored in `.local/attachments`; containers use `/data/attachments`. Back up both the database and files.

The VPS update worker checks GitHub Releases daily and downloads new releases in the background. Settings > Server > Updates offers manual checking and click-to-install upgrades, with database/file backups, migrations, progress, and recovery. Pushing to `main` runs GitHub CI. Use **Actions > Publish release > Run workflow** to build and publish a coordinated release with server images, the Windows installer, and the signed Android APK. The current version is **0.1.0**. See [builds and releases](.github/README.md) for the one-time signing setup. The [desktop setup wizard](apps/desktop/README.md#set-up-a-vps) installs the worker with a new server. Actual GitHub publishing and public production deployment remain unverified.

GIF provider integration was cancelled; uploaded GIFs and animated project/channel images remain supported. Windows Tauri packaging and the native SSH setup wizard are implemented. Reordering controls, light theme, public deployment, resource benchmarking, and Linux/macOS packaging are pending. Full initial provisioning from a public release and DNS/TLS behavior on real VPSs remain unverified.

- [Builds and releases](.github/README.md)
- [Windows client and server setup](apps/desktop/README.md)
- [Android client and notifications](apps/android/README.md)

Channel settings also manage a non-clickable image shown above the sidebar channel list. The former Channels + heading is removed. Channel images accept pictures/GIFs and are included in portable backups.

Click the top-left Noted logo seven times in quick succession to open diagnostics on web or desktop. It includes connection/readiness/version checks, notification status, a server-to-phone push test, a local notification test where supported, app-data refresh, client reload, and a copyable report.
