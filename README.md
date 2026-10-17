# Noted

A self-hosted notes app where writing a note feels like sending a chat message.

Noted runs on your VPS with your domain and an owner username/password account. Access the same notes through a browser, the Windows client, or the Android app.

## Features

- Projects, categories, and channels for organizing notes.
- Markdown, code highlighting, message editing, and search.
- File attachments, image previews, inline video playback, and animated project/channel images.
- Reminder channels, `/remind`, repeating reminders, Done, Snooze, and Web Push notifications.
- Account-wide appearance preferences and four message layouts.
- Active sessions with individual sign-out.
- Portable ZIP backups containing notes and files, excluding credentials and server configuration.
- SSH server installation and VPS transfer, domain switching, and confirmed server removal.
- Daily update checks with manual installation from Settings.

## Hosting and clients

Use the [Windows setup wizard](apps/desktop/README.md#set-up-a-vps) to install a published release on your VPS over SSH. Enter the server details, domain, and owner credentials, then configure your DNS record. DNS changes remain manual.

The Android app opens your server through a Chrome Trusted Web Activity. Each server generates its own Web Push keys; owners do not need Firebase setup or a notification relay. See [Android installation and notifications](apps/android/README.md).

Messages and metadata live in PostgreSQL. Attachments use a persistent filesystem volume. Back up both the database and files, or export a portable ZIP through **Settings > Backups**.

See [builds and releases](.github/README.md) for CI, signing the Android APK, and publishing version **0.1.0**. Pushing to `main` runs CI; publishing uses **Actions > Publish release > Run workflow**. Existing servers discover releases automatically and install them when you choose **Settings > Server > Updates > Update server**.

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

Open **http://localhost:5173** and sign in with the username and password chosen above. Create a workspace and a channel to begin writing. The desktop setup preview is at **http://localhost:5173/setup-preview** in development only.

Instances are owner-only, with no public registration or default credentials. Session cookies are HTTP-only, writes require CSRF protection, and authentication attempts are rate limited.

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

## Project structure

| Directory | Purpose |
| --- | --- |
| `apps/web` | Shared React interface |
| `apps/desktop` | Windows client and SSH setup wizard using Tauri |
| `apps/android` | Android Trusted Web Activity client |
| `backend` | FastAPI API, feature modules, PostgreSQL models, and migrations |
| `updater` | VPS updates and hosting operations |
| `deploy` | Docker Compose and Caddy configuration |
| `scripts` | Development, testing, and release tools |

## Diagnostics

Click the top-left Noted logo seven times in quick succession to open diagnostics on web or desktop. It provides connection checks, notification tests, app refresh, and a copyable diagnostic report.
