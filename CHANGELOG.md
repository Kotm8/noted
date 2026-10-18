# Changelog

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
