# Changelog

## 0.4.1

- Add Nutrition below Habits while AI is connected. Set it up in four steps (about you, how you move from your tracked time and habits, your goal, your target): Noted works out maintenance with the Mifflin–St Jeor formula and the AI proposes a target and macros inside safety limits, with its reasons and sources, which you can adjust before using it.
- Log meals by describing them, adding photos, or both. Items stream in with how sure the estimate is, one optional question can correct the total, and amounts scale calories and macros together; nothing is saved until Save meal. Remember meals to log them again in one tap, log weight with a smoothed trend, and see the day as a ring, macro bars and a week chart.
- The shared assistant can see the last week of meals and propose logging or editing them for review, and can make a picture for a meal without a photo (also from the meal's Make a picture). Settings › Nutrition holds the profile and target, and Settings › Saved meals lets you browse and edit saved meals. Backups include Nutrition and meal photos.
- Add Habits below Calendar, using the approved daily list with manual check-offs, clickable counts, activity-linked minute goals and synced progress. Optional reminders default off and reuse the current reminder timeline and calendar picker. Habit content and progress are included in portable backups.
- Share one AI assistant across Home, Calendar and Habits. Review proposed habit and calendar-plan edits before applying them together, with ownership/revision checks, conflict detection, editable calendar previews and retry protection. Habit notifications open their habit on web and updated Android clients.
- AI can search and read your Noted messages, journals and documents as needed, including planning from a journal in the calendar. Searches show Noted activity and source links, remain scoped to the signed-in owner, and never apply calendar changes without review. Picture-only messages support Ask AI; selected JPEG, PNG, WebP and GIF attachments are sent as bounded image inputs, with GIFs using their first frame and originals kept unchanged.
- Ask AI directly from a message's action button or menu without selecting it first. Rewrite just that message or add an AI reply to its thread, including messages inside an existing thread.
- Fix AI answers and rewrites failing after successful generation when saving decimal usage costs to history. Channel pinning stays in the sidebar menu instead of the top-right channel menu.
- Calendar workdays and days off are configurable per account, using chosen weekdays or rotating work/off cycles. One-off date overrides leave the repeating pattern intact. Both types are labeled, and days off have a slightly lighter background without restricting planning or tracking.
- Calendar plan editors update locally and close immediately, with creates, edits, copies, moves, resizes and deletes syncing in the background. Changes to the same plan stay ordered; failed saves retain a reviewable draft. Cached time formatting and calendar rendering reduce pop-out delays on high-latency connections.
- On Android, Switch server is inside Settings > Server.
- Ask AI directly in the calendar with a docked planner and phone bottom sheet. Choose up to 31 days, set separate calendar preferences in Settings > AI, then review editable suggestions using your active activities. Preview, exclude, move, resolve overlaps, and apply selected plans together with retry protection. The original add-only calendar application's Undo/redo API is retained.
- Ask AI in journals and Notes documents follows the approved writing designs: selection-aware prompts, inline rewrite previews with Apply, Cancel and Undo, entry answers, and Look back across journal entries. Document answers open a docked conversation with follow-ups, saved conversations, and a preview before inserting into the document.
- AI results show Thinking, web searches, elapsed thinking time and linked sources. Web search has one global switch. History groups document conversations, and schema 0026 safely upgrades both earlier versions of schema 0025.
- Named day templates in Settings > Time tracking use D01's horizontal timeline and the calendar's pop-out block editor. Save an existing day or build a template, then use the button under a calendar date to add one-off plans without replacing existing plans or starting the tracker.
- Note templates have their own Settings section with N01's library, Markdown editor, and preview. Insert a copy from the writing toolbar into messages, replies, journals, and Notes documents, preserving spaces and blank lines. Templates sync across devices and are included in portable backups.
- AI on your own ChatGPT plan, through Pydantic AI's Codex sign-in with no API key. Connect in Settings › AI with Noted's own ChatGPT sign-in (or a pasted auth.json), then select messages and choose Ask AI: write a prompt or pick a saved one. Rewrites stream onto the messages with the old text struck through and change nothing until Apply; the originals stay in each message's edit history. Prompts can also reply in a thread, draft into the composer, or just answer, with Save as note.
- Settings › AI sets the model (gpt-6.1-sol by default), how hard it thinks, a standing note added to every prompt, and whether prompts can search the web (off by default), and shows your plan's Codex usage. Saved prompts have their own instructions, result, places, context, and model; History lists every run and what came of it.

## 0.4.0

- Images use compressed WebP previews and S01 loading placeholders that reserve their shape. Click to view the untouched original with zoom, pan, image navigation and download. GIF previews animate inline, and original GIFs animate in the viewer. Existing images get previews automatically in the background.
- Writing nudges count tracked minutes, preserve the countdown while paused, and restart after writing in the selected channel. Configure an activity default, override it per plan, and optionally get a final nudge when stopping. Nudges open the channel and follow the existing notification and quiet-hours settings.
- Changes appear on your other devices right away, with polling as a fallback, and the watch receives quiet sync pushes to stay up to date.
- The rail holds only your projects; Home and Calendar are at the top of the sidebar.
- Deleting a one-off plan or a recorded session asks in Noted's own dialog.
- A plan's Activity notification menu starts with Default.
- The calendar's day labels no longer show Plan and Actual.
- GIF previews play inline; animated project icons play on hover.
- Click empty space in a journal to start a new entry.
- Image previews and project icons stay cached on every device instead of loading each time.
- The calendar loads four weeks per request and fetches the next block before you scroll to it, and moved plans stay where you drop them while saving.
- Undo and redo calendar changes with Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y): adding, moving, resizing, copying, and deleting plans. Undoing a delete brings back the same plan with its edited occurrences and prompt history.
- Plans starting at the same moment share one notification with a Start button for each; delaying delays them together.
- When the plan you're tracking ends while an overlapping plan is still running, its end notification offers to switch to it.
- Quiet hours in Settings › Notifications hold notifications on every device, including the watch, and send them when quiet hours end. Test notifications still go through.
- Mark a reminder urgent to let it ring during quiet hours.
- Click a plan or empty time in the calendar to edit it in a small card beside it: title, activity, and times, with More options for the full form. A dashed placeholder shows a new plan before it's saved, a blank title takes the activity's name, and clicking elsewhere moves the card there.
- The reminder picker shows the chosen time large, offers In 1 hour (now the default), In 3 hours, This evening, and Tomorrow morning, and has a slider across the next 24 hours. Other date opens the full date picker.
- Select messages from the gutter beside their times: click one, drag down for a range, or Shift-click to extend, then copy or delete them together. Clicking the text still selects text.
- Every edit keeps the earlier text. Click "edited" to see each version and restore any of them; ticking checklist items isn't counted as an edit. Backups include the history.
- Messages, files, and thread replies written without a connection wait on the device as "Waiting to send" and go out in order when it returns, never twice.
- Isolate browser test data between cases and wait for the actual watch face to finish rendering before taking emulator screenshots.

## 0.3.0

- Format messages with a Slack-style toolbar in messages, replies, edits, journals, and documents: bold, italic, strikethrough, headings, links (Ctrl+K), lists, checklists, quotes, code, and dividers. Aa shows or hides it; Send's menu holds Schedule message.
- Mention channels with # in messages, replies, journals, and documents. Mentions keep working after a channel is renamed.
- Enter continues bulleted, numbered, and checklist items and ends the list on an empty one; Ctrl+Enter sends from inside a list. Every Shift+Enter now shows as a new line.
- Messages written while another is still sending are sent next, in order, instead of being dropped.
- Share a message's text and files to other apps from the phone's share menu, or download its files.
- Add Tasks channels, where every message becomes a checklist item, and pin channels to Home.
- The calendar scrolls continuously, copies a plan with Ctrl-drag, plans with a right-click, and has a new timeline time picker. Calendar is always in the rail.
- Reorganised Settings into one fixed-size window: Appearance, Notifications, Time tracking (no tabs), Server with Sessions, Backups, Devices with Watch appearance, and Desktop app. Settings save as you change them.
- Each notification alerts once on the phone and is mirrored to the watch; the watch shows its own only when the phone can't be reached.
- Set up a server without a domain, using a free address made from its IP. Moving it to another VPS, or a changed IP, updates the address from the desktop app.
- Install and update the phone and watch apps from the desktop app, over USB or Wi-Fi.
- The desktop app can start with Windows, optionally minimized, and updates in two clicks from its notice, with release notes and Skip this version.
- The watch app has a new Home with your activity in the middle. Starting a plan from a notification opens the watch and confirms once the server has done it, and outdated notifications say why they no longer apply. Watch settings has Diagnostics with a test notification.
- The watch face has ten layouts to choose from in Customize, including faces with steps, sleep, and battery.
- A new startup animation on web, desktop, and Android, and the Android app no longer shows the browser while it loads.

## 0.2.6

- Fix server upgrades from 0.2.3 by declaring the Wear OS and plan-ending database schemas as supported upgrade sources.
- Validate release schema compatibility during publishing and use the real release policy in upgrade checks.

## 0.2.5

- Run a smaller core backend/browser suite by default, with full suites available manually, while retaining fast unit tests and release safety checks.
- Keep long project lists inside the scrollable rail so they cannot push channel controls and writing sidebars outside the viewport.
- Keep the startup logo visible until the first page is prepared, and load channel content before switching views across web, desktop, and Android.
- Drag channels and whole categories on desktop, including moving channels between categories, with server-saved order and touch dragging disabled.
- Swipe right near the left side to open Android navigation, or left on the sidebar to close it.
- End-of-plan prompts offer No activity or Snooze while the same session is running, and skip the alert when another plan starts within 15 minutes.
- Task-switch notification links open the activity sidebar on mobile, with finishing the current task selected as the default delay reason.
- Improved watch readability, round-screen spacing, delay choices, and all three face layouts, with real Wear OS emulator captures.
- New plans default to the current schedule time rounded to 15 minutes, with a one-hour duration capped at midnight.
- Isolated publisher test summaries from the real CI summary and resolved React Fast Refresh warnings.

## 0.2.3

- Faster Windows CI builds through Rust dependency caching and release signing of the tested installer without recompiling.
- Fixed updater signing failures caused by whitespace in the private signing key.

## 0.2.2

- Windows desktop update checks, signed downloads, and installation on request, with progress and release notes.
- Fixed watch preference controls reverting while a save is pending.

## 0.2.1

- Bundled the watch face inside the Wear OS APK, with in-app installation, updates, and activation on Wear OS 6 or newer.
- Native Wear OS app with activity switching, pause/stop, planned activity prompts, required delay reasons, and reminder actions.
- Watch pairing from Android, independently revocable watch sessions, and shared watch preferences in Settings.
- A Noted watch face with 24-hour time, three content layouts, a tracker tile, reusable complications, and editable edge data without colored background bands.
- Removed channel pictures from the sidebar and channel settings.
- Styled the category selector in channel settings to match the other dropdowns.

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
