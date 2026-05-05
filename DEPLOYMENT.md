# Deployment

How n8n-desk's release pipeline works, what it produces, and what you need to ship a build.

---

## TL;DR

1. Bump `package.json` version (optional — CI overrides it from the tag anyway)
2. `git tag v0.2.0 && git push --tags`
3. On GitHub: **Releases → Draft a new release → choose tag → Publish**
4. Wait ~10 minutes
5. Installers for macOS, Windows, and Linux appear as release assets

That's the whole flow. Everything below explains the moving parts.

---

## What Happens When You Publish a Release

`.github/workflows/release.yml` triggers on the `release: published` event and runs three jobs in parallel:

| Runner | Builds | Output artifacts |
|---|---|---|
| `macos-latest` | universal arm64 + x64 | `n8n-desk-{version}.dmg`, `n8n-desk-darwin-arm64-{version}.zip`, `n8n-desk-darwin-x64-{version}.zip` |
| `windows-latest` | x64 | `n8n-desk-setup.exe` (Squirrel installer), `n8n-desk-{version}-full.nupkg`, `RELEASES`, `n8n-desk-win32-x64-{version}.zip` |
| `ubuntu-latest` | x64 | `n8n-desk_{version}_amd64.deb`, `n8n-desk-{version}.AppImage`, `n8n-desk-linux-x64-{version}.zip` |

Per-job sequence:

1. Checkout repo
2. Install pnpm (version pinned by `packageManager` field in `package.json`)
3. Install Node 20 with pnpm cache
4. (Linux only) `apt-get install fakeroot dpkg rpm` — required by the `.deb` maker
5. **Sync version** — overwrite `package.json` `version` field with the release tag (e.g. `v0.2.0` → `0.2.0`) so installer metadata matches the GitHub release
6. `pnpm install --frozen-lockfile`
7. `pnpm build` (Vite renderer build → `dist/`)
8. `pnpm build:electron:ts` (esbuild bundles `electron/main.ts` + `electron/preload.ts` → `electron/dist/`)
9. `pnpm exec electron-forge make --arch=<arch>` (runs the platform's makers, output to `out/make/`)
10. Upload artifacts to the release via `softprops/action-gh-release@v2`

Failure on any one runner does **not** cancel the others (`fail-fast: false`). You'll see partial assets on the release if e.g. only Windows fails.

---

## Prerequisites

### Required (just to ship)

- **GitHub repo with Actions enabled** (default for public repos; check Settings → Actions if private)
- **Default `GITHUB_TOKEN` permissions** — the workflow needs `contents: write` to upload assets to the release. This is declared inline in the workflow (`permissions: contents: write`), so no repo-level permission tweaks are needed unless your org has restricted Actions
- **A pushed tag** matching `v*.*.*` convention (e.g. `v0.2.0`, `v0.2.0-rc.1`)
- **A GitHub release** created from that tag (workflow only fires on `release: published`, not on tag push alone)

### Not required (yet)

- ❌ No Apple Developer account
- ❌ No Windows code-signing certificate
- ❌ No notarization secrets
- ❌ No `ANTHROPIC_API_KEY` or other runtime secrets at build time (the app reads those from user config at runtime)

The unsigned artifacts work — users just see first-launch OS warnings (see [User Install Experience](#user-install-experience)).

### Required to develop locally

- **Node 20+**
- **pnpm 9+** (`npm i -g pnpm` or `corepack enable`)
- **Platform-specific tooling** if you want to make installers locally:
  - **macOS**: nothing extra — Xcode CLT helps but isn't required for unsigned DMG
  - **Windows**: nothing extra
  - **Linux**: `sudo apt-get install fakeroot dpkg rpm` (or your distro's equivalent)

---

## Triggering a Release

### Standard release

```bash
# Make sure main is clean and pushed
git checkout main
git pull

# Tag and push
git tag v0.2.0
git push origin v0.2.0
```

Then on GitHub:

1. Go to **Releases** → **Draft a new release**
2. Select the tag you just pushed
3. Fill in title and notes (or click "Generate release notes")
4. Click **Publish release**

The workflow starts automatically. Watch progress in the **Actions** tab.

### Pre-release (recommended for first run)

Same flow, but tag with a pre-release suffix and check the "This is a pre-release" box:

```bash
git tag v0.2.0-rc.1
git push origin v0.2.0-rc.1
```

This lets you validate the pipeline end-to-end without publishing to general users.

### Manual dry run (no release, no tag)

For testing the workflow itself:

1. Go to **Actions** → **Release Build** → **Run workflow**
2. Pick a branch
3. Click **Run workflow**

Artifacts upload to the workflow run page (downloadable for 90 days) instead of attaching to a release. The version-sync step is skipped on manual runs — `package.json` version is used as-is.

---

## User Install Experience

### macOS

User downloads `n8n-desk.dmg`, opens it, drags app to Applications.

**First launch is blocked** by Gatekeeper because the app is unsigned:

> "n8n-desk" cannot be opened because the developer cannot be verified.

**Workaround**: right-click the app → **Open** → confirm the dialog. Required only on first launch.

To fix this properly, see [Future: Code Signing](#future-code-signing).

### Windows

User downloads `n8n-desk-setup.exe`, runs it. Squirrel installs to `%LOCALAPPDATA%\n8n-desk\` and creates a Start menu entry.

**SmartScreen warning** appears on first run because the binary is unsigned:

> Windows protected your PC.

**Workaround**: click **More info** → **Run anyway**.

### Linux

- **`.deb`**: `sudo apt install ./n8n-desk_0.2.0_amd64.deb`
- **AppImage**: `chmod +x n8n-desk-0.2.0.AppImage && ./n8n-desk-0.2.0.AppImage`

No signing warnings on Linux. AppImage is portable (no install needed), `.deb` integrates with the system menu.

---

## Local Testing Before Pushing a Release

Before relying on CI, verify the pipeline runs locally on at least one platform:

```bash
# Smoke test on the host platform
pnpm install
pnpm make:electron
```

Inspect `out/make/`:

- macOS: `out/make/zip/darwin/...` and `out/make/n8n-desk-{version}.dmg`
- Windows: `out/make/squirrel.windows/x64/n8n-desk-setup.exe`
- Linux: `out/make/deb/x64/*.deb` and `out/make/AppImage/x64/*.AppImage`

Open the artifact (`open out/make/...dmg` on macOS) and confirm the app launches and reaches Onboarding.

To test the GitHub Actions workflow itself without publishing a release, use the manual dry run (above).

---

## Troubleshooting

### "No matching files found" when uploading to release

The maker glob in `release.yml` didn't match anything. Causes:

- **Maker silently failed** — check the `Run electron-forge make` step's logs for warnings. `MakerSquirrel` in particular fails quietly if `setupExe` collides with an existing file
- **Path mismatch** — forge changed its output path layout in a major version. Verify by running `pnpm make:electron` locally and inspecting `out/make/`

### `pnpm install --frozen-lockfile` fails on CI

The lockfile is out of sync with `package.json`. Fix locally:

```bash
pnpm install
git add pnpm-lock.yaml
git commit -m "chore: sync pnpm-lock.yaml"
```

### macOS DMG build fails with "hdiutil: create failed"

Usually a stale resource in `out/`. Clean and retry:

```bash
rm -rf out/ dist/ electron/dist/
pnpm make:electron
```

### Linux `.deb` build fails with "fakeroot: command not found"

The CI step that installs `fakeroot dpkg rpm` was skipped (only runs on `ubuntu-latest`). Locally on Linux: `sudo apt-get install fakeroot dpkg rpm`.

### Version on installer doesn't match release tag

The version-sync step only runs on `release: published` events, not `workflow_dispatch`. For manual runs, bump `package.json` version manually before triggering.

### Artifacts uploaded but the release page shows none

GitHub caches the release page aggressively. Hard-refresh or check the API:

```bash
gh release view v0.2.0
```

---

## File Map

| File | Role |
|---|---|
| [.github/workflows/release.yml](.github/workflows/release.yml) | The CI workflow itself |
| [forge.config.ts](forge.config.ts) | Electron Forge config — declares makers (DMG, Squirrel, Deb, AppImage, Zip) |
| [scripts/build-electron.mjs](scripts/build-electron.mjs) | esbuild bundler for the Electron main + preload processes |
| [package.json](package.json) | `make:electron` script, `packageManager` pin, maker dev-deps |
| [pnpm-lock.yaml](pnpm-lock.yaml) | Canonical lockfile (`package-lock.json` is gitignored) |

---

## Future: Code Signing

Unsigned builds work but show OS warnings on first launch. To remove them:

### macOS — Apple Developer signing + notarization

**Prerequisites:**

- Apple Developer Program membership (€/$99/year)
- A "Developer ID Application" certificate exported as `.p12`
- An app-specific password for your Apple ID

**GitHub secrets to add:**

- `APPLE_CERT_P12_BASE64` — base64-encoded `.p12` certificate
- `APPLE_CERT_PASSWORD` — password for the `.p12`
- `APPLE_ID` — your Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD` — generated at appleid.apple.com
- `APPLE_TEAM_ID` — your Team ID

**Workflow changes**: import the cert into the runner's keychain, set `osxSign` and `osxNotarize` in `forge.config.ts`. `@electron/notarize` is already a transitive dep — just needs wiring.

### Windows — Authenticode signing

**Prerequisites:**

- A code-signing certificate from a CA (DigiCert, Sectigo, etc. — €/$200-500/year for OV; EV is more expensive but bypasses SmartScreen immediately)

**GitHub secrets to add:**

- `WIN_CERT_P12_BASE64` — base64-encoded `.pfx`/`.p12`
- `WIN_CERT_PASSWORD`

**Workflow changes**: pass `certificateFile` and `certificatePassword` to `MakerSquirrel` in `forge.config.ts`.

### Linux

No signing required. Optionally GPG-sign `.deb` files if you publish your own apt repo — not needed for direct downloads.

---

## Future: Auto-Updater

`MakerSquirrel` already produces a `RELEASES` file and `.nupkg` — the bits Squirrel.Windows needs for auto-update. To wire it up:

- Add `update-electron-app` (uses GitHub Releases as the update feed) to the renderer/main process
- Or set up `update.electronjs.org` (free, public-repo only) — zero-config beyond the package
- macOS auto-update needs signing first (Apple requires it)

Tracked as a follow-up — not blocking first release.
