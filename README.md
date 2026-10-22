# Noted

A self-hosted notes app where writing a note feels like sending a chat message.

Noted brings quick thoughts, longer journal entries, reminders, and activity planning into one workspace. Notes are organized into projects and channels, with threads for following an idea without interrupting the main conversation.

## Features

- **Home:** A daily agenda from your calendar, project navigation, upcoming reminders, and missed activity with shared read status.
- **Chat-style notes:** Markdown, code highlighting, interactive checklists, editing, search, and adjustable message grouping.
- **Threads and journals:** Resizable thread sidebars and named journal entries with autosave and Markdown preview.
- **Notes channels:** A continuous Markdown page with autosave, preview, and interactive checklists.
- **Files and media:** Attachments up to 250 MB, image previews, inline video playback, and custom project icons.
- **Reminders:** Dedicated reminder channels, `/remind`, repeating reminders, and Done and Snooze actions.
- **Send later:** Schedule a chat message once, then review, edit, or cancel it from the channel menu. Messages missed during server downtime are skipped.
- **Writing prompts:** Recurring nudges to write in a channel, with custom weekdays and automatic completion when you post.
- **Time tracking:** A global activity tracker that stays in sync across devices, with custom activities and editable session history.
- **Scheduling:** Horizontal week and day views, one-off and recurring plans, drag editing, and planned time displayed above actual tracked time.
- **Activity prompts:** Start a planned activity, delay its prompt with a reason, or switch to another activity while keeping the original plan in place.
- **Plan endings:** Stop tracking or snooze when a planned activity ends, with end alerts skipped when another plan starts within 15 minutes.
- **Navigation:** Drag channels and categories into order on desktop, and swipe to open the sidebar in the Android app.
- **Notifications:** Browser Web Push and optional native Android notifications through the server owner's Firebase project. Phone alerts are suppressed while Noted is focused on a PC.
- **Wear OS:** A native activity and reminder client, 24-hour watch face, tracker tile, and configurable complications, with watch pairing and preferences managed from the Android app. The watch face is included in the watch APK and can be installed inside the app on Wear OS 6 or newer.
- **Desktop updates:** The Windows client checks published releases and verifies signed downloads. Installation happens when you choose to restart.
- **Personalization:** Custom colors, text size, zoom, and four message layouts, saved to the owner's account.
- **Server management:** Portable ZIP backups, import, VPS transfer, domain switching, and updates installed on demand.

## Your server, across your devices

Noted runs on a VPS behind your own HTTPS domain. A private owner account provides access from the browser, Windows desktop client, and Android app. The current version is owner-only.

Messages and metadata are stored in PostgreSQL. Uploaded files use a persistent filesystem volume. Portable backups contain notes, files, journals, and tracking and schedule history, without account credentials or server configuration.

The Windows client includes an SSH setup wizard and optional persistent sign-in backed by Windows Credential Manager. The Android client uses Chrome for the app interface and native Firebase messaging for optional notification actions. Each server manages its own data and notification subscriptions.

## Built with

| Part | Technology |
| --- | --- |
| Shared interface | React and TypeScript |
| API | Python, FastAPI, and SQLAlchemy |
| Storage | PostgreSQL and filesystem volumes |
| Windows client | Tauri and Rust |
| Android client | Kotlin, Trusted Web Activity, and Firebase Cloud Messaging |
| Watch client | Native Kotlin, Wear OS Tiles, complications, and Watch Face Format |
| Hosting | Docker Compose and Caddy |

The monorepo contains the shared interface in `apps/web`, native clients in `apps/desktop` and `apps/android`, feature modules and migrations in `backend`, and server management in `updater`.

- [Changelog](CHANGELOG.md)
