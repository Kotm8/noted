# Changelog

## 0.2.0

### Added

- Optional persistent Windows desktop sign-in using Windows Credential Manager, with saved sessions removed on sign-out or server switching.
- One-off scheduled chat messages with a reviewable, editable queue and cancellation. Messages missed during server downtime are skipped.
- Recurring channel writing prompts with custom weekdays, biweekly/monthly recurrence, Home activity, and browser/Android notifications. Writing in the channel completes its current prompt.
- Portable backups include scheduled messages and writing prompt rules, without device sessions or credentials.
- Home with a daily agenda from the real calendar, project navigation, upcoming reminders, and missed activity with read status synced across devices.
- Android Back closes open panels before returning from channels and Calendar to Home, with channel drafts and scroll positions preserved.
- Branded startup with the Noted logo drawn in sequence, a loading bar, reduced-motion support, and connection timeout/retry handling. Android's connection screen uses the same logo sequence.
- Notes channels with a single Markdown page, autosave, interactive checklists, search, and portable backup support.
- Native Android Firebase notifications, with optional setup in the desktop installer or server settings, project validation, and private credentials stored only on the owner's VPS.
- Android notification settings unlock after Firebase setup, with a guide that disappears when configured and a separate phone delivery toggle.
- Planned activity notifications with per-plan timing, account defaults, and inline bottom-left prompts on web and desktop. Start immediately, delay with a required reason, or switch to another activity without moving the plan.
- Native Android notification actions for starting activities, replying with a delay reason, and choosing other activities or delay lengths.
- Global time tracker with inline activity switching, pause/resume, custom activity icons/colors, reordering, archiving, and editable session history.
- Horizontal week and daily activity schedules with one-off and recurring plans, custom weekdays, biweekly/monthly recurrence, drag editing with Undo, and upcoming reminder flags.
- Account-wide schedule start/end hours and timezone settings, styled selectors, and portable backups for activities, recorded sessions, plans, recurrence exceptions, and activity prompt history.
- Interactive Markdown task checkboxes in messages, thread replies, and journal previews.
- Resizable message threads with reply counts, independent replies, and saved reply drafts.
- Journal channels with named entries, Markdown editing, autosave, and conflict-safe draft recovery.
- Search and portable backup support for thread replies and journal entries, including older backup imports.

## 0.1.1

### Added

- Cleanup for failed or unfinished VPS installations, with inspection and explicit confirmation.
- Copy button beside Edit for note text.
- Account-wide message grouping interval, adjustable from 1 to 30 minutes.
- Release notes loaded automatically from the matching version in this changelog.

### Fixed

- Closely timed messages splitting at clock-minute boundaries.
- Windows line endings breaking server preparation scripts.
- Owner account creation failing when credentials were passed to the backend.
- Cloudflare rejecting updater and VPS transfer verification requests.

## 0.1.0

- Initial self-hosted release with web, Windows, and Android clients.
