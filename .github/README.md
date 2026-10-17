# Builds and releases

The current app version is **0.1.0**. Release versions must match in the backend, web, Windows, and Android project files. `scripts/release_version.py` checks them and supplies the release workflow's version automatically.

## CI

Pushing to `main` or opening a pull request targeting `main` runs:

- Backend lint, formatting, typing, PostgreSQL integration tests, updater tests, and publisher tests.
- Web lint, unit tests, and production build.
- Chrome browser tests against an isolated database.
- Windows installer build and Rust tests.
- Android build, unit tests, and lint.
- Docker server upgrade and backup restoration tests.

CI can also be run from the Actions tab. It does not publish a release or change a VPS. Successful Windows builds are downloadable as workflow artifacts. CI uses disposable databases and test data, without production credentials or signing keys.

## Set up Android signing once

The release APK must use the same signing key as previous distributed APKs. Never generate a new key for each workflow run.

Open repository **Settings > Secrets and variables > Actions > New repository secret**, and add:

| Secret | Value |
| --- | --- |
| `ANDROID_SIGNING_KEYSTORE` | Contents of `.local/github-secrets/ANDROID_SIGNING_KEYSTORE.txt` |
| `ANDROID_SIGNING_PASSWORD` | Contents of `.local/github-secrets/ANDROID_SIGNING_PASSWORD.txt` |

These files have been prepared from the existing local signing key and are ignored by Git. On another build machine, restore the private signing files and run `python scripts/android.py github-secrets` to prepare them. This workflow expects the existing `noted` key alias and matching store/key passwords.

The workflow restores the key only on its temporary runner, verifies its public certificate against the committed `apps/web/public/.well-known/assetlinks.json`, and removes the private key afterward. Pull-request checks never receive the signing secrets.

Back up `.local/android/signing.json` and its keystore privately. Firebase credentials are not used.

## Publish an update

1. Commit and push the finished changes to `main`.
2. Open **Actions > Publish release > Run workflow**, choose `main`, and click **Run workflow**.
3. The workflow runs the complete CI checks, signs the Android APK, builds and uploads both server images, and verifies that the images can be downloaded publicly.
4. It uploads the server manifest, deployment bundle, updater, Windows installer, Android APK, and `SHA256SUMS` to a draft GitHub Release. Only after every upload succeeds does it publish the release, titled `v0.1.0` for this version.

GitHub supplies `GITHUB_TOKEN` automatically. No personal publishing token, Docker login command, or VPS credentials are required on your PC. The release job has repository-content write permission, and only the image job has package-write permission. See [GitHub's container publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

On the first run, GitHub may create `noted-backend` and `noted-web` as private packages. Open your GitHub profile's **Packages**, open each package's settings, and set its visibility to **Public**. If the public-download check stopped the workflow, use **Re-run failed jobs** after changing both packages. The repository's releases must also be publicly accessible for the desktop installer.

The release tag remains `main-<commit>` because the existing installer and updater verify that relationship. The displayed release title and all app versions use `0.1.0`. Published releases are never overwritten. A changed `main` during publication leaves the release unpublished and requires a new run from the current commit.

## Install the update

An existing VPS with the updater configured finds the release during its daily check, or through **Settings > Server > Updates > Check for updates**. Installation still requires clicking **Update server** and confirming it.

A new VPS can be installed through the Windows client's setup wizard using `kotm8/noted` as its release repository. Download the Windows installer and APK from the GitHub Release. Client installers are updated separately from the VPS.

The first hosted Actions run and public release still require verification after these files are pushed. Nothing here commits, pushes, changes DNS, or connects to the VPS.
