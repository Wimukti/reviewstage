# Rename inventory — ReviewStage → `<Name>` (slug `<name>`)

Snapshot of `main` on 10/10/26. Every place the old brand lives, what kind of thing it is, and
how each machine identifier moves (or deliberately does not). Companion to `name-test.md`
(choosing the name) and `openspec/changes/go-to-tool/assessment.md` §4 (why). Nothing here has
been changed yet; `scripts/brand-audit.sh` reproduces the numbers below in about 6 seconds.

Search: case-insensitive `review[ -]?stage` plus the retired tagline `Stage your review`, over
every tracked or untracked-but-not-ignored file, skipping `node_modules`, `dist`, `.git`,
`__pycache__`, `test-results`, lockfiles and binary media (`.mp4 .gif .png .jpg .icns .ico .tgz`).

## 1. Totals

| | Hits | Files (approx.) | Representative |
| --- | ---: | ---: | --- |
| (a) user-visible brand string — UI, site, docs | 331 | ~110 | `bin/server.py:66 BRAND = "ReviewStage"`, `website/src/content/brand.ts:5`, `README.md:11` |
| (b) machine identifier — must not change or needs a compatibility path | 330 | ~70 | `desktop/lifecycle.js:78 LAUNCH_AGENT_LABEL`, `bin/rs_paths.py:23 ~/.reviewstage`, `desktop/package.json:10 "bin"` |
| (c) external asset — domain, GitHub slug, npm, YouTube, media | 57 | ~35 | `website/public/CNAME`, `README.md:32 youtu.be/yYMtQK-sVyg`, `website/public/videos/reviewstage-demo.mp4` |
| (d) launch copy — `docs/launch/*` | 59 | 15 | `docs/launch/show-hn.md`, `docs/launch/video/voiceover-script.md` |
| (e) tests and fixtures asserting on the brand | 109 | 30 | `desktop/test/lifecycle.test.mjs:257`, `dashboard-ui/e2e/pwa.spec.ts:14`, `bin/test_rs_push.py:251` |
| **Total** | **886** | **186** | |

Hits by top-level directory: `docs/` 195 · `website/` 139 · `dashboard-ui/` 126 · `desktop/` 122 ·
`bin/` 89 · `openspec/` 80 · root files 76 · `.github/` 25 · `deploy/` 15 · `skills/` 9 · `assets/` 5.

Not counted: 55 distinct `RS_*` environment variable names (section 2.b.1, kept forever) and the
`rs_*.py` module file names. Nothing brand-related in `LICENSE` (copyright is to the maintainer; do
not touch). There is no `CODEOWNERS` and no root `SECURITY.md` (`docs/SECURITY.md` has 6 hits, all (a)).

## 2. Category detail

### (a) User-visible brand strings — 331

Where the name is *shown*. These all change to `<Name>` in the rename commit; no compatibility
concern, only completeness (the audit script is the completeness check).

| Surface | Hits | Files / examples |
| --- | ---: | --- |
| Dashboard UI (React) | ~45 | `dashboard-ui/src/Login.tsx:173` (tagline), `Tour.tsx` (7, "Welcome to ReviewStage"), `Welcome.tsx`, `UpdateBanner.tsx`, `nav.tsx`, `ui.tsx`, `DesktopApp.tsx` (5), `Skills.tsx`, `Settings.tsx`, `Integrations.tsx`, `PrPage.tsx`, `Rollup.tsx`, `PushDevices.tsx`, `App.tsx`; CSS class/token comments in `tokens.css`, `styles.css` |
| PWA shell | 7 | `dashboard-ui/public/manifest.webmanifest:2-3` (`name`, `short_name`), `offline.html:7,42,47`, `sw.js:1,34,89,112` (push fallback title) |
| Server-rendered strings | ~15 | `bin/server.py:66 BRAND`, `:181`, `:5177` ("ReviewStage test" notification), `:5803`, `:5850`, `:6319`, `:6461` startup line; `bin/notify.sh:129,278` (Slack text/footer); `bin/run-qa.sh:127,223`; `bin/entrypoint.sh:171`; `bin/poller-loop.sh:39`; `bin/doctor.sh:2,15,37,76,82,86` |
| Desktop app chrome | ~20 | `desktop/main.js:60` window title, `:153` error copy, `:193` `setTitle`, `:459-460` update notifications, `:507` "Open ReviewStage", `:517` "Quit ReviewStage", `:537` tray tooltip, `:654,687` console; `desktop/pages/preparing.html:5,39`; `desktop/bin/reviewstage.js:32,113,119` console copy; `lifecycle.js:162,253,254` error copy |
| Public website copy | ~75 | `website/src/content/brand.ts` (category sentence, home title), `astro.config.mjs:47,82,91`, `components/home/*.astro`, `marketing/SiteHeader|SiteFooter|Shot|Mark.astro`, `starlight/SiteTitle.astro`, `pages/404.astro`, `styles/tokens.css`, all 19 pages under `content/docs/**` (titles, prose, `install.mdx:2`) |
| Repo docs | ~130 | `README.md` (35), `docs/OPERATIONS.md` (39), `docs/SETUP.md` (23), `docs/INSTALL-DESKTOP.md` (25), `docs/INSTALL-DOCKER.md`, `docs/MOBILE.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/push-proof.md`, `docs/specs/*.md` (25), `desktop/README.md` (18), `deploy/README.md`, `CONTRIBUTING.md:3`, `CHANGELOG.md:3,73,245,407` |
| GitHub meta | 11 | `.github/ISSUE_TEMPLATE/bug_report.yml:36,46`, `feature_request.yml:2,17`, `docs.yml:2`, `setup_problem.yml`, `config.yml:8`; workflow display name `ci.yml:61 "Desktop (npx reviewstage smoke)"` |
| Skills shipped to Claude | 9 | `skills/pr-review/SKILL.md:89`, `skills/repo-profile/SKILL.md:3`, `skills/pr-qa-guide/SKILL.md:12,52,103,147`, `skills/examples/*.md` — these are read by the model, so a stale name here leaks into generated reviews |
| OpenSpec history | 80 | `openspec/config.yaml:4,5,21` (live project context — change) and `openspec/changes/**` (historical — allowlist, do not rewrite) |
| Python docstrings/comments | ~10 | `bin/rs_paths.py:3`, `rs_learn.py`, `rs_push.py`, `rs_profile.py`, `rs_rollup.py`, `rs_personal.py`, `rs_assets.py`, `demo-fixture.py`, `desktop/flock.py:12` |

### (b) Machine identifiers — 330

Each one with its migration strategy. "Keep forever" = never rename; "alias" = new name primary,
old accepted/emitted alongside; "migrate" = one-time migration on first start + fallback read.

#### b.1 Environment variables `RS_*` — **keep forever**

55 distinct names (`scripts/brand-audit.sh --env` lists them with counts): `RS_SECRET` (120 uses),
`RS_PORT`, `RS_PERSONAL`, `RS_E2E_PORT`, `RS_COOKIE_SECURE`, `RS_DOMAIN`, `RS_PUSH`, `RS_HOST_PORT`,
`RS_SPA`, `RS_ENV`, `RS_SMOKE`, `RS_MAX_PR_AGE_DAYS`, `RS_LAUNCH_NODE`, `RS_ACTOR`, `RS_USER`,
`RS_RETENTION_DAYS`, `RS_BIND`, `RS_REPOS_EXTRA`, `RS_HOST_ALIASES`, `RS_SIGNATURE_GRACE_DAYS`,
`RS_SMOKE_OK`, `RS_RUN_AS`, `RS_QA_TIMEOUT`, `RS_MODEL`, `RS_STATUS_FILE`, `RS_LAUNCH_PATH`,
`RS_WEBHOOK_WORKERS`, `RS_TRUSTED_PROXIES`, `RS_SEARCH_LIMIT`, `RS_ORG_SEARCH_LIMIT`, `RS_HOST`,
`RS_EFFORT`, `RS_DESKTOP_DEFAULTS`, `RS_STACK`, `RS_SKILL_CHOICE`, `RS_QA_SKILL`, `RS_FOCUS`,
`RS_DEPTH`, `RS_TUNNEL_LIVE`, `RS_SKIP_UI_BUILD`, `RS_SHOTS`, `RS_REPOS_CONFIGURED`, `RS_PHONE`,
`RS_E2E_PERSONAL_PORT`, `RS_CACHE_KEY`, `RS_VIDEO_OUT`, `RS_SHOTS_PORT`, `RS_SMOKE_FAIL`,
`RS_SITE_PORT`, `RS_SITE_PERF_MIN`, `RS_SHOOT_PORT`, `RS_POLL_TOKEN_FROM`, `RS_KEY`,
`RS_DOCTOR_IN_CONTAINER`, `RS_AWS_TOKEN`.

Why: every `.env` on every install (`~/.reviewstage/.env`, Docker `.env`) holds `RS_SECRET`; a
rename would be a second breaking identifier change after the `PRBOT_*` → `RS_*` one
(`CHANGELOG.md:562`). "RS" is opaque to users and not a brand string. Document once in
`docs/SETUP.md` / `website/.../configuration.md`: "`RS_` is the historical prefix." Same rule for
the `rs_*.py` modules, `rs_assets.py`, `.rs-pr-context.md` (`skills/pr-qa-guide/SKILL.md:52`),
and `RS_HOST`'s legacy default `reviewstage-<env>.<domain>` (`bin/lib-common.sh:37`,
`bin/server.py:511`) — that default only matters to pre-1.0 installs; keep it.

#### b.2 Data root `~/.reviewstage` (`ROOT`) — **migrate: fallback read, no move**

The one directory that holds everything: `.env`, `users.json` (encrypted tokens), `settings.json`,
`state/`, `repos/`, `skills/` (a git repo), `learnings.jsonl`, `push_vapid.json`, `desktop.json`,
`desktop.log`, `server.log`, `bin/` (fetched tools), `electron/` (when `ROOT` is custom), `MIGRATED`.

Default is computed in **13 places** that must all agree:
`bin/rs_paths.py:23`, `bin/server.py:89`, `bin/lib-common.sh:5`, `bin/entrypoint.sh:14`,
`bin/doctor.sh:18`, `bin/bootstrap.sh:18`, `bin/poller-loop.sh:18`, `bin/notify.sh:43`,
`bin/pr-watch.sh:7` (cron comment), `desktop/bin/reviewstage.js:20,124`, `desktop/main.js`
(`ROOT`), `desktop/flock.py:12`, `Dockerfile:58` (`ROOT=/home/reviewstage/.reviewstage`).

Strategy: new default `~/.<name>`; when `ROOT` is unset **and** `~/.<name>` does not exist **and**
`~/.reviewstage` does, use `~/.reviewstage` (log one line, `doctor.sh` prints a WARN with the
exact `mv ~/.reviewstage ~/.<name> && ln -s ~/.<name> ~/.reviewstage` to run). No automatic move:
the directory is referenced by absolute path from the LaunchAgent plist (`ROOT` env),
cron lines (`pr-watch.sh:7`), systemd units written by `bootstrap.sh`, and Compose volumes; a
move the app does on its own would strand those. Put the fallback in one Python helper
(`rs_paths.default_root()`) and one bash function (`lib-common.sh`), and have the other 11 sites
call them. Docker: keep `/home/reviewstage/.reviewstage` and user `reviewstage` in the
`Dockerfile` forever (section b.9) — the path is inside the image and invisible to users.

#### b.3 npm package `reviewstage`, bin `reviewstage`, `npx reviewstage` — **migrate with shim**

`desktop/package.json:2 "name"`, `:10 "bin": { "reviewstage": "./bin/reviewstage.js" }`,
`:20 "start"`; `desktop/bin/reviewstage.js` (file name + `npx reviewstage@latest` copy);
`desktop/update.js:26` (`${registry}/reviewstage`) and `:76` (`npx -y reviewstage@<v>
--wait-for-lock`); `desktop/lifecycle.js:87` (LaunchAgent and `.app` both run `npx -y
reviewstage@latest`); `.github/workflows/release-npm.yml:39,64-66,78,83,86`; `ci.yml:61`;
`website/src/content/install.ts:3`; 50+ doc lines.

Strategy: publish `<name>` as the real package; publish a final `reviewstage@1.1.0` **shim**
(section 5.1) whose bin prints "ReviewStage is now <Name>" and execs `npx -y <name>@latest` with
the same arguments — so `npx reviewstage`, the 1.0.2 updater (`update.js:76` passes
`--wait-for-lock`), the old LaunchAgent and the old `.app` launcher all land in the new app. Then
`npm deprecate reviewstage "ReviewStage is now <name>: npx <name>"`. The new `update.js` checks
`${registry}/<name>`. The shim stays published indefinitely (it is one file; unpublishing would
break every login item written before the rename).

#### b.4 macOS LaunchAgent, Linux autostart, launcher bundle — **migrate on first start**

| Identifier | Where | Strategy |
| --- | --- | --- |
| LaunchAgent label `dev.reviewstage.desktop`, file `~/Library/LaunchAgents/dev.reviewstage.desktop.plist` | `desktop/lifecycle.js:78,90`; docs | New label `dev.<name>.desktop`. On first start of the new app: if the old plist exists → `launchctl bootout gui/$UID/dev.reviewstage.desktop`, delete it, write the new one (autostart stays on — presence of the old plist *is* the user's choice). Old plist's `ProgramArguments` point at `npx -y reviewstage@latest` + `ROOT`; the shim covers the window between npm publish and the user's first launch. |
| Launcher plist label `dev.reviewstage.launcher`, `~/Applications/ReviewStage.app` (`Contents/MacOS/ReviewStage`, `Resources/ReviewStage.icns`, stamp `reviewstage-launcher.json`) | `lifecycle.js:180,202-210,257,263,266` | On first start: if `~/Applications/ReviewStage.app` exists → remove it, write `~/Applications/<Name>.app`. Spotlight re-indexes on its own. Note the Electron.app re-branding in `bin/reviewstage.js:65` writes `CFBundleIdentifier io.reviewstage.desktop` (inconsistent `io.` vs `dev.` today) and stamp `.reviewstage-branded`; the new package gets a fresh Electron.app in the npm cache, so just use `dev.<name>.desktop` and `.<name>-branded` — no migration. |
| Linux `~/.config/autostart/reviewstage.desktop`, `~/.local/share/applications/reviewstage.desktop`, `~/.local/share/icons/reviewstage.png`, `Name=ReviewStage`, `StartupWMClass=ReviewStage` | `lifecycle.js:127-144,181,229,234,274` | Same first-start swap: remove the three old files if present, write the new ones. `StartupWMClass` must equal the new `app.setName` value or the dock icon splits. |

Tests pinning these: `desktop/test/lifecycle.test.mjs:174,250,257` (26 hits) and
`dashboard-ui/e2e/always-on.spec.ts:49` (mocked plist path).

#### b.5 Electron `app.setName("ReviewStage")` → `userData` directory — **migrate: rename dir before `ready`**

`desktop/main.js:647`. With no custom `ROOT`, Electron stores cookies, cache and the
`rs_session` cookie (which `main.js:178` reads to decide "signed in") under
`~/Library/Application Support/ReviewStage` (macOS) / `~/.config/ReviewStage` (Linux). Renaming
the app silently signs every desktop user out. Strategy: before `app.whenReady()`, if the new
userData path is absent and the old one exists, `renameSync` old → new (same volume). When
`ROOT` is custom the path is `ROOT/electron` (`main.js:648`) and nothing moves.

#### b.6 Browser-side keys — mixed

| Key | Where | Strategy |
| --- | --- | --- |
| `localStorage` `rs-theme` | `dashboard-ui/src/theme.ts:10`, `public/offline.html:13`, `bin/server.py:3420,3433`, 20 e2e files | **Keep forever** (opaque prefix; `docs/launch/good-first-issues.md:18` even references it). |
| `localStorage` `rs-update-dismissed` | `dashboard-ui/src/desktop.ts:82` | Keep forever. |
| `localStorage` `reviewstage.repoFilter` | `dashboard-ui/src/repoFilter.ts:2` | **Migrate**: read `<name>.repoFilter`, fall back to the old key, write new, remove old. One function, three lines. |
| Service-worker cache `rs-__BUILD__` (was `rs-v1`) | `dashboard-ui/public/sw.js:30`, `bin/test_rs_static_assets.py:7`, `e2e/sw-upgrade.spec.ts:176` | Keep the `rs-` prefix forever; the build stamp already evicts old caches on activate (`sw.js:48-49`). |
| Cookies `rs_session`, `rs_client`, `rs_devnonce` | `bin/server.py:2908,4104`, `desktop/main.js:178`, `dashboard-ui/e2e/shot.mjs:17`, `CHANGELOG.md:54,562` | **Keep forever** — renaming signs out every browser and phone. |
| Window events `reviewstage:navigate|theme|repo-filter|open-palette|start-tour` | `dashboard-ui/src/router.tsx:17`, `theme.ts:12`, `repoFilter.ts:3`, `CommandPalette.tsx:13`, `Tour.tsx:54`, `Skills.tsx:1089`, `running.ts:90` | Internal to one bundle: rename atomically in the same commit, no compat. |
| Preload bridge `window.reviewstage` | `desktop/preload.cjs:7`, `desktop/pages/preparing.html:57-65`, `phone.html:69-122` | Internal (preload + pages ship together): rename atomically. `dashboard-ui/src/desktop.ts` / `phone.ts` detect the desktop by this global — change both sides in one commit. |

#### b.7 Wire identifiers seen by other systems

| Identifier | Where | Strategy |
| --- | --- | --- |
| Webhook headers `X-ReviewStage-Signature`, `X-ReviewStage-Event`, UA `ReviewStage-Webhook/1` | `bin/notify.sh:14,288-297`, `.env.example:69`, `website/.../notifications.mdx:105-106`, `bin/test_rs_notify.py:127-128`, `dashboard-ui/e2e/app.spec.ts:350` | **Alias for 6 months**: send both `X-<Name>-*` and `X-ReviewStage-*` headers; document the new names as canonical; drop the old pair in a later minor and note it in the CHANGELOG. Integrators verify the signature by header name. |
| Custom URL scheme `reviewstage://auth`, `reviewstage://pr` | `bin/server.py:2977`, `docs/MOBILE.md:89,126,158,171`, `website/.../mobile.md` | No shipped app registers the scheme yet (Capacitor app is roadmap) — rename freely to `<name>://`. |
| VAPID default subject `https://reviewstage.dev` | `bin/rs_push.py:135-137` (fallback when `PUBLIC_URL` is not https), `bin/test_rs_push.py:251-259`, `config.example:68` | Change to the new domain. Does **not** invalidate subscriptions (only the key pair does — `notifications.mdx:234`). `push_vapid.json` path follows `ROOT`. |
| HTTP `Server` header `server_version = "reviewstage"` | `bin/server.py:4122` | Rename freely. |
| Skills-repo git identity `ReviewStage <reviewstage@reviewstage.local>`, author `<editor>@reviewstage.local` | `bin/server.py:1149-1150,1177` | Rename freely; old commits keep the old identity, which is correct history. |
| Shared GitHub OAuth device-flow client ID `Ov23liHjtjxcPNwXC6Y5` | `CHANGELOG.md:547`, `README.md:87`, `website/.../configuration.md:85`, `security/index.md:54` | Client ID stays. Rename the OAuth App itself in github.com/settings/developers (the name users see on the device page). Per-install OAuth Apps (`GH_CLIENT_ID`) are the operator's own. |
| `reviewstage.example.com` in deploy samples | `deploy/caddy/Caddyfile:3,6,12,31`, `deploy/README.md:23,51-57,83,101`, `dashboard-ui/e2e/app.spec.ts:394` | Placeholder hostname: change to `<name>.example.com` (cosmetic). `cloudflared tunnel create reviewstage` is the operator's tunnel name — leave the instruction generic. |

#### b.8 Build / release / CI identifiers

| Identifier | Where | Strategy |
| --- | --- | --- |
| Docker image tags `reviewstage:local`, `reviewstage:ci` | `docker-compose.yml:32,76`, `.github/workflows/ci.yml:48,53`, `bin/doctor.sh:58` (regex that detects "this is our Compose project") | Rename; `doctor.sh:58` regex must match **both** `image: reviewstage` and `image: <name>` for a year because users' `docker-compose.override.yml` may pin the old tag. |
| Compose volume names `reviewstage-data`, `reviewstage-demo` | `docker-compose.yml:46,84,89-90` | **Keep forever** as the volume *name*: renaming the key would create an empty volume and hide every user's data. If the key must read `<name>-data`, add `name: reviewstage-data` under it so the on-disk volume is unchanged. Document in `docs/INSTALL-DOCKER.md`. |
| Container user/home `reviewstage`, `/home/reviewstage/.reviewstage` | `Dockerfile:56-73`, `bin/doctor.sh:42`, `docs/push-proof.md:58` | **Keep forever** (internal to the image; bind-mount paths in users' override files depend on it). |
| systemd `reviewstage.service`, Apache `reviewstage.conf`, `reviewstage-{error,access}.log`, `a2ensite reviewstage` | `bin/bootstrap.sh:206-280` (legacy bare-metal Linux install) | Migrate inside the idempotent script: if `/etc/systemd/system/reviewstage.service` exists → `systemctl disable --now reviewstage`, remove, install `<name>.service`; same for the Apache site. `docs/OPERATIONS.md` (39 hits) is mostly these unit names. |
| Tarball glob `reviewstage-*.tgz`, secret note "package reviewstage" | `release-npm.yml:39,64-66,78` | Rename with the package; the npm granular token must be re-issued scoped to `<name>` **and** (once) to `reviewstage` for the shim publish. |
| Private workspace package names `reviewstage-website`, `reviewstage-dashboard-ui` | `website/package.json:2`, `dashboard-ui/package.json:2` | Rename freely (never published). |
| Dev tarball `desktop/reviewstage-0.0.0-dev.tgz` | untracked artefact | Delete. |
| Git clone paths `~/reviewstage`, `cd reviewstage` | `bin/bootstrap.sh:4-5`, `website/src/content/install.ts:6`, docs | Follow the repo rename (GitHub redirects the clone URL, but the directory name in the instructions changes). |

#### b.9 Identifiers that are brand-free and need nothing

`desktop.json` (at `ROOT/desktop.json` — follows b.2), `users.json`, `settings.json`, `.env`,
`queue.json`, `seen`, `learnings.jsonl`, `/oauth/callback`, `/webhooks/github`, `/api/*`,
`LICENSE` (both copies).

### (c) External assets — 57 in-repo references, plus the assets themselves

| Asset | In-repo references | Strategy |
| --- | --- | --- |
| Domain `reviewstage.dev` (registered 10/05/26, GitHub Pages custom domain) | `website/public/CNAME`, `robots.txt:3` (sitemap URL), `astro.config.mjs:12 site`, `README.md` (21), `.github/ISSUE_TEMPLATE/docs.yml:2,10`, `dashboard-ui/src/ui.tsx|Settings.tsx|Login.tsx` (help links), `desktop/pages/phone-strings.cjs:32`, `desktop/package.json:7 homepage`, `bin/rs_push.py` default subject, `website/scripts/verify-site.mjs:112`, 9 launch files | Register `<name>.dev`; main site moves there; `reviewstage.dev` keeps resolving to a redirect stub for ≥ 12 months (section 5.3). |
| GitHub repo `Wimukti/reviewstage` | `desktop/package.json:9`, `astro.config.mjs:79,82` (edit link, social), `site-links.ts:8`, `install.ts:6`, `.github/ISSUE_TEMPLATE/config.yml:4,7` (advisories, discussions), `README.md`, 10 docs/launch files, `troubleshooting.md` (3), `install.mdx` (2) | `gh repo rename` (section 5.2); GitHub redirects web + git URLs until a repo reuses the old name — never create `Wimukti/reviewstage` again. Update references anyway so nothing depends on the redirect. |
| npm `reviewstage` | see b.3 | Shim + deprecate. |
| YouTube `yYMtQK-sVyg` (70-second voiced demo) | `README.md:32`, `docs/launch/youtube.md` | The end card and one voice-over word say "ReviewStage" (`docs/launch/video/voiceover-script.md`, `captions.srt`). Re-render with `pnpm launch-video` (`dashboard-ui/e2e/launch-video.ts`, 30 hits — it draws the wordmark and writes `reviewstage-launch-thumbnail.png`), upload as a new video, keep the old one up with a pinned "now <Name>" comment. |
| GitHub social preview `github-social-preview.png` (1280×640, uploaded by hand in repo settings) | generated by `launch-video.ts:7` | Regenerate and re-upload. |
| `website/public/og.png` (1280×640) | `astro.config.mjs:57`, `MarketingLayout.astro:76-77`, `verify-site.mjs:129` | Regenerate (`website/scripts/shoot-home.mjs` family). |
| `website/public/videos/reviewstage-demo.mp4` | `site-links.ts:55,59` | Rename file to `<name>-demo.mp4` and update the reference; content shows the old UI chrome — re-record with the rest. |
| `docs/demos/{review,wizard,phone,phone-access}.{mp4,gif,jpg}` | README / docs embeds | UI inside shows the old name; re-record after the UI rename, or accept. |
| Logo SVGs `assets/logo-{light,dark,mark,wordmark}.svg` | `aria-label="ReviewStage"` on all four; wordmark has the name set as outlined paths | Mark: change `aria-label`. Wordmark: redraw the glyphs, then `pnpm brand` (`dashboard-ui/scripts/brand.mjs`) to regenerate `bin/rs_assets.py`. |
| `desktop/assets/*.icns|png`, `website/public/favicon*`, `apple-touch-icon.png` | binary | Icon is the mark, not the name — unchanged unless the mark changes. |
| GitHub OAuth App (shared client ID) | b.7 | Rename in GitHub settings. |

### (d) Launch copy — 59 hits in 15 files

`docs/launch/{README,show-hn,x-thread,linkedin,youtube,awesome-lists,good-first-issues,
design-partners,reddit-claudeai,reddit-claudecode,reddit-experienceddevs,reddit-opensource,
reddit-selfhosted}.md`, `docs/launch/video/{voiceover-script.md,captions.srt}`. Not yet posted
(per `assessment.md` §4 the rename is before launch). Strategy: rewrite in place, no history
needed; `name-test.md` in this directory is the only launch-adjacent file that keeps the old
name on purpose (allowlist it).

### (e) Tests and fixtures asserting on the brand — 109 hits in 30 files

| File | Hits | What it asserts |
| --- | ---: | --- |
| `desktop/test/lifecycle.test.mjs` | 26 | plist path/label, `.app` path, `Name=`, `StartupWMClass`, `npx reviewstage@latest` args |
| `desktop/test/smoke.test.mjs` | 7 | `title=ReviewStage` in `RS_SMOKE_OK`, "ReviewStage is running…", "ReviewStage quit…" log lines |
| `dashboard-ui/e2e/launch-video.ts` + `shots-*.ts`, `demos.ts`, `fixture.ts`, `personal-fixture.ts` | ~39 | screenshot/video fixtures: wordmark, captions, `~/.reviewstage` paths in mocked status |
| `dashboard-ui/e2e/always-on.spec.ts` | 8 | update banner text, plist path, offline copy, `<h1>ReviewStage` |
| `dashboard-ui/e2e/pwa.spec.ts` | 5 | `manifest.name`, offline page copy, `<h1>` |
| `dashboard-ui/e2e/app.spec.ts` | 4 | tour text, `X-ReviewStage-Signature` shown in Integrations, help link `reviewstage.dev/#how-it-works`, sample webhook URL |
| `dashboard-ui/e2e/{shell,phone-access,mobile-shell,welcome,pr-page,pages,auth}.spec.ts` | 11 | `<h1>`, tagline "Stage your review. Post it as yourself.", titles |
| `website/scripts/verify-site.mjs` | 5 | `<title> = h1 + " | ReviewStage"`, sitemap URL, `npx reviewstage` on the install page |
| `bin/test_rs_push.py` | 3 | default VAPID subject `https://reviewstage.dev` |
| `bin/test_rs_notify.py` | 2 | webhook header names (after b.7 aliasing, assert both pairs) |

Strategy: update in the rename commit; where a compat path exists (b.4, b.5, b.6 repoFilter,
b.7 headers, b.2 root fallback) add a test for the *old → new* path, not just the new value.

## 3. What is deliberately kept (summary of "keep forever")

`RS_*` env names · `rs_*.py` modules · `~/.reviewstage` accepted as fallback root · cookies
`rs_session`/`rs_client`/`rs_devnonce` · `localStorage` `rs-theme`, `rs-update-dismissed` · SW cache
prefix `rs-` · Compose volume names `reviewstage-data`/`reviewstage-demo` · Docker user and home ·
`RS_HOST` legacy default · npm `reviewstage` kept published as the shim · `reviewstage.dev` DNS
for ≥ 12 months · `LICENSE` untouched · `openspec/changes/**` and past `CHANGELOG.md` entries untouched.

## 4. Automated check that fails if old brand strings remain

`scripts/brand-audit.sh` (bash 3.2+, ~6 s, no dependencies beyond git/grep/awk):

```
scripts/brand-audit.sh                      # every hit, grouped (a)–(e); exit 1 — today: 886
scripts/brand-audit.sh --quiet              # counts and summary only
scripts/brand-audit.sh --env                # also the 55 RS_* names (informational)
scripts/brand-audit.sh openspec/changes/rename/allowlist.txt   # the post-rename gate
```

The allowlist is a file of `path-glob:ERE` lines; a hit passes when the path matches the glob
(bash pattern; `*` crosses `/`) **and** the line matches the ERE. The intended post-rename
allowlist (`openspec/changes/rename/allowlist.txt`, to be created with the rename):

```
# history stays as written
openspec/changes/*:.
CHANGELOG.md:.
# the shim package and the transition notices
desktop/shim/*:.
README.md:ReviewStage is now
website/src/content/docs/*:ReviewStage is now
desktop/bin/<name>.js:ReviewStage is now
# compatibility paths that must mention the old identifiers
bin/rs_paths.py:\.reviewstage
bin/lib-common.sh:\.reviewstage
bin/doctor.sh:reviewstage
bin/bootstrap.sh:reviewstage\.(service|conf)
bin/notify.sh:X-ReviewStage
desktop/lifecycle.js:dev\.reviewstage|ReviewStage\.app|reviewstage\.desktop|reviewstage\.png
desktop/main.js:Application Support/ReviewStage|ReviewStage
dashboard-ui/src/repoFilter.ts:reviewstage\.repoFilter
docker-compose.yml:name: reviewstage-(data|demo)
Dockerfile:reviewstage
# tests of those compatibility paths
desktop/test/lifecycle.test.mjs:dev\.reviewstage|ReviewStage\.app|reviewstage\.desktop
bin/test_rs_notify.py:X-ReviewStage
# the website redirect stub keeps the old domain
website/redirect-stub/*:.
```

Wire it as a CI step (`.github/workflows/ci.yml`) once the rename lands:
`run: scripts/brand-audit.sh openspec/changes/rename/allowlist.txt --quiet`.

## 5. Migration plan

Order matters: each step leaves every existing install working. Dates to be filled in MM/DD/YY.

### 5.0 Before touching the repo

1. Name chosen per `name-test.md`; `npm view <name>` 404; `<name>.dev` registered; GitHub repo
   name `Wimukti/<name>` free; X / YouTube handles as desired.
2. DNS: `<name>.dev` → GitHub Pages (A/AAAA records per GitHub docs, plus `www` CNAME).
3. npm granular token re-issued for packages `<name>` **and** `reviewstage` (publish), stored as
   `NPM_TOKEN` (checked by `release-npm.yml:39`).
4. Rename the GitHub OAuth App behind `Ov23liHjtjxcPNwXC6Y5` to `<Name>` (no code change).

### 5.1 The code rename (one PR, `rename-staging`)

1. Mechanical pass: `grep -rl` from `scripts/brand-audit.sh` output; `ReviewStage` → `<Name>`,
   `reviewstage` → `<name>` in categories (a), (d), (e) and the (b) items marked "rename freely" —
   excluding every path the allowlist above names and the keep-forever list in section 3.
2. Compatibility code (section 2.b):
   - `bin/rs_paths.py` `default_root()` + `bin/lib-common.sh` `default_root` with the
     `~/.reviewstage` fallback; the other 11 sites call them. `doctor.sh` WARN with the `mv`/`ln -s`.
   - `desktop/lifecycle.js`: `LAUNCH_AGENT_LABEL = "dev.<name>.desktop"`, `LEGACY_LAUNCH_AGENT_LABEL`,
     `migrateLegacyAutostart(home, platform)` and `migrateLegacyLauncher(home, platform)` called once
     from `main.js` before anything else writes files; args `["-y", "<name>@latest"]`.
   - `desktop/main.js`: `app.setName("<Name>")`; before `whenReady`, rename the userData dir (b.5).
   - `desktop/update.js:26,76`: `<name>`.
   - `dashboard-ui/src/repoFilter.ts`: read-old/write-new.
   - `bin/notify.sh`: emit `X-<Name>-Signature|Event` **and** the old pair; UA `<Name>-Webhook/1`.
   - `bin/doctor.sh:58`: `image:[[:space:]]*(reviewstage|<name>)(:|$)`.
   - `docker-compose.yml`: keep volume names (or `name:` pins); image `<name>:local`.
   - `bin/bootstrap.sh`: old unit/site detection + replacement.
3. Package: `git mv desktop/bin/reviewstage.js desktop/bin/<name>.js`; `desktop/package.json`
   `name`, `bin`, `homepage`, `repository`, `description`, `start`; `release-npm.yml` globs.
4. Assets: new wordmark SVG → `pnpm brand`; `aria-label`s; `og.png`; `desktop/assets` if the mark
   changes; `git mv website/public/videos/reviewstage-demo.mp4 website/public/videos/<name>-demo.mp4`.
5. Website: `astro.config.mjs` `site = "https://<name>.dev"`; `public/CNAME` → `<name>.dev`;
   `robots.txt` sitemap; `brand.ts`; `site-links.ts`; `install.ts`.
6. `CHANGELOG.md`: new top entry "**ReviewStage is now <Name>**" listing the kept identifiers and
   the compat paths. `README.md`: one-line notice under the H1 for six months.
7. `openspec/config.yaml` lines 4, 5, 21; leave `openspec/changes/**` alone.
8. Add `openspec/changes/rename/allowlist.txt`; CI step `scripts/brand-audit.sh <allowlist> --quiet`
   must pass; `pnpm test` in `desktop/` and `dashboard-ui/`, `python3 -m unittest` in `bin/`,
   `website/scripts/verify-site.mjs` all green.

### 5.2 Publish and rename (same day, in this order)

1. **Merge** the rename PR to `main`.
2. **Publish the new package**: tag `v1.1.0` → `release-npm.yml` publishes `<name>@1.1.0` to
   `latest`. Smoke: `npx <name>@1.1.0 --foreground` on a clean account (section 6).
3. **Publish the shim** `reviewstage@1.1.0` from `desktop/shim/` (contents below), by hand:
   `cd desktop/shim && npm publish --provenance --access public`. Then
   `npm deprecate reviewstage "ReviewStage is now <Name>. Run: npx <name>"`. Version 1.1.0 is
   deliberately higher than 1.0.2 so the old in-app updater (`update.js` `updateAvailable`) sees it,
   installs it with `npx -y reviewstage@1.1.0 --wait-for-lock`, and the shim forwards into `<name>`.
4. **Rename the repo**: `gh repo rename <name> --repo Wimukti/reviewstage --yes`. GitHub redirects
   `github.com/Wimukti/reviewstage` (web, clones, issues, releases) to the new slug.
   Locally: `git remote set-url origin git@github.com:Wimukti/<name>.git`.
   Re-upload the social preview in Settings → General.
5. **Website**: the `website.yml` Pages deploy now serves the Astro site at `<name>.dev`
   (new `CNAME` file). GitHub Pages settings → custom domain `<name>.dev`, enforce HTTPS.
6. **Old-domain redirect stub** (section 5.3) deployed to a new repo `Wimukti/reviewstage-redirect`
   (not `reviewstage` — that name must stay free so the repo redirect keeps working), with
   `CNAME reviewstage.dev`; move the `reviewstage.dev` DNS to that Pages site.
7. **YouTube**: upload the re-rendered demo; pin a comment on the old one.
8. Post-rename **verification** (section 7).

### 5.3 Website redirects on GitHub Pages (no server redirects available)

GitHub Pages serves static files only and one custom domain per site, so `reviewstage.dev` needs
its own tiny Pages site whose every old route is an HTML page that redirects to the same path on
`<name>.dev`. Routes to cover (from `website/src/pages` and `website/src/content/docs`):

```
/                              /start/            /start/install/        /start/first-review/
/guides/reviewing/             /guides/qa-guide/  /guides/insights/      /guides/notifications/
/guides/repo-profile/          /guides/skills-and-learnings/   /guides/team-mode/   /guides/team-workflow/
/operations/configuration/     /operations/faq/   /operations/troubleshooting/
/security/                     /developers/architecture/   /developers/contributing/
/developers/mobile/            /developers/roadmap/        /404.html
```

Generate them rather than hand-write: `website/scripts/redirect-stub.mjs` reads the content
collection (same glob Starlight uses), writes `website/redirect-stub/<route>/index.html` per route
plus `404.html` (which redirects to `https://<name>.dev/` + the requested path via
`location.replace`, catching anything not enumerated), and `CNAME`. Each page:

```html
<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>ReviewStage is now <Name></title>
<link rel="canonical" href="https://<name>.dev/start/install/">
<meta http-equiv="refresh" content="0; url=https://<name>.dev/start/install/">
<meta name="robots" content="noindex">
<script>location.replace("https://<name>.dev/start/install/" + location.search + location.hash)</script>
</head><body><p>ReviewStage is now <Name>. Continue to
<a href="https://<name>.dev/start/install/">https://<name>.dev/start/install/</a>.</p></body></html>
```

Deploy with a second job in `website.yml` (`peaceiris/actions-gh-pages` or `gh-pages` branch
push to `Wimukti/reviewstage-redirect`, `external_repository`). Keep `robots.txt` on the stub
with `Sitemap:` pointing at the new domain so crawlers migrate; `noindex` on the stubs plus
canonical on the real pages is what Google treats as a move. Keep for ≥ 12 months.

Alternative if the two-site setup is unwanted: Astro's `redirects` config emits the same
meta-refresh pages, but only on one host — it cannot redirect from an old *domain*.

### 5.4 Desktop: bundle, LaunchAgent, app shortcut migration (what the new app does on first start)

In `desktop/main.js` before `app.whenReady()` resolves, in this order:

1. `userData`: if `~/Library/Application Support/<Name>` (or `~/.config/<Name>`) is absent and the
   `ReviewStage` one exists → rename it. (Only when `ROOT` is not custom.)
2. `ROOT` fallback (b.2): resolved once; everything below uses it.
3. `migrateLegacyAutostart`: old plist present → `launchctl bootout gui/$UID/dev.reviewstage.desktop`
   (ignore errors), `rm`, then `writeAutostart()` with the new label and `npx -y <name>@latest`.
   Linux: swap `~/.config/autostart/reviewstage.desktop`.
4. `migrateLegacyLauncher`: `~/Applications/ReviewStage.app` present → `rm -rf`, then
   `ensureInApplications()` writes `~/Applications/<Name>.app` (new `CFBundleIdentifier
   dev.<name>.launcher`, exe `Contents/MacOS/<Name>`, `<Name>.icns`, stamp `<name>-launcher.json`).
   Linux: swap the `.desktop` file and `~/.local/share/icons/reviewstage.png`.
5. `desktop.json` content is unchanged (brand-free); its path follows `ROOT`.

Each step is wrapped so a failure logs to `desktop.log` and never blocks startup; each is a no-op
on a fresh machine. `lifecycle.test.mjs` gets one test per step with a fake `$HOME`.

### 5.5 Workflows

- `ci.yml`: image tag `<name>:ci`, job name "Desktop (npx <name> smoke)", add the brand-audit step.
- `release-npm.yml`: tarball glob `<name>-*.tgz`, summary lines, token note; it keeps publishing
  from the renamed repo (Actions follow the rename).
- `website.yml`: add the redirect-stub job (5.3).
- Dependabot: no brand strings. Issue templates: text only (category a).

### 5.1 appendix — the `reviewstage` shim package, verbatim

`desktop/shim/package.json`

```json
{
  "name": "reviewstage",
  "version": "1.1.0",
  "description": "ReviewStage is now <Name>. This package forwards `npx reviewstage` to `npx <name>`.",
  "license": "MIT",
  "homepage": "https://<name>.dev/",
  "repository": { "type": "git", "url": "https://github.com/Wimukti/<name>.git", "directory": "desktop/shim" },
  "bin": { "reviewstage": "./bin/reviewstage.js" },
  "type": "module",
  "engines": { "node": ">=20" },
  "files": ["bin/"],
  "keywords": ["<name>", "deprecated"]
}
```

`desktop/shim/bin/reviewstage.js`

```js
#!/usr/bin/env node
// ReviewStage is now <Name>. `npx reviewstage` — from a terminal, the 1.0.x in-app updater
// (`npx -y reviewstage@<v> --wait-for-lock`), an old LaunchAgent or ~/Applications/ReviewStage.app —
// lands here and is forwarded, arguments intact, to the real package. No Electron, no deps.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (!args.includes("--wait-for-lock")) {
  console.error("ReviewStage is now <Name>. Starting it: npx <name>" + (args.length ? " " + args.join(" ") : ""));
  console.error("Next time run `npx <name>` directly. Details: https://<name>.dev/start/install/");
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npx, ["-y", "<name>@latest", ...args], { stdio: "inherit", env: process.env });
child.on("error", (e) => { console.error(`could not start <name>: ${e.message}`); process.exit(1); });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
```

Why `@latest` and not a pinned version: the shim is published once and must keep forwarding to
whatever `<name>` is current. Why no `--foreground` handling: the new bin decides detach vs
foreground from the forwarded args exactly as today (`lifecycle.shouldDetach`).

## 6. Rollback

Each step is independently reversible; the order below undoes 5.2 from the back.

1. **Website**: revert the `website/` commit; `public/CNAME` back to `reviewstage.dev`; move DNS
   back; delete or leave the stub repo (harmless).
2. **Repo**: `gh repo rename reviewstage --repo Wimukti/<name> --yes` (allowed because the old
   name was never reused). Remote URLs and redirects flip back.
3. **npm**: `npm deprecate <name> "withdrawn"`. Then make `reviewstage` a real app again:
   publish `reviewstage@1.1.1` with the *old desktop package contents* (the pre-rename
   `desktop/` tree, version bumped) so `latest` is a working app, not the shim. Users who already
   took the 1.1.0 shim get offered 1.1.1 by the same `latest` comparison; users still on 1.0.2
   skip the shim entirely. `npm unpublish reviewstage@1.1.0` only if within 72 h; otherwise
   leave it — it is superseded, not harmful.
4. **Desktop installs already migrated** (userData dir, plist, `.app` renamed): the reverted app
   must contain the inverse of 5.4 or those users re-enable "open at login" by hand and sign in
   again. Decision: keep the forward migration code in the rollback build and add the inverse
   only if a rollback actually happens — the inverse is the same four functions with the names
   swapped.
5. **Data**: nothing moves `~/.reviewstage`, cookies, volumes or `RS_*`, so no data rollback exists.
6. **Code**: `git revert` of the rename merge commit; the brand-audit step is removed with it.

## 7. Verification checklist (clean environment: fresh macOS user account or VM, no `~/.reviewstage`, no npm cache)

Fresh install
- [ ] `npx <name>` prints "<Name> is running. You can close this terminal.", window titled `<Name>`,
      tray tooltip `<Name>`, menu shows "Open <Name>" / "Quit <Name>"; `~/.<name>/desktop.log` written.
- [ ] `~/Applications/<Name>.app` exists, launches from Spotlight, `CFBundleIdentifier dev.<name>.launcher`.
- [ ] Settings → Desktop → "Open at login" writes `~/Library/LaunchAgents/dev.<name>.desktop.plist`
      with `ProgramArguments … npx -y <name>@latest`; `launchctl print gui/$UID/dev.<name>.desktop` ok.
- [ ] `npx <name> --doctor` all PASS; `--foreground` prints `RS_SMOKE_OK … title=<Name>` under `RS_SMOKE=1`.
- [ ] Linux VM: `~/.config/autostart/<name>.desktop`, `~/.local/share/applications/<name>.desktop`, icon.

Upgrade from 1.0.2
- [ ] Install `npx reviewstage@1.0.2`, sign in, turn on open-at-login, set a repo filter and light
      theme. Quit. `npx reviewstage` → shim notice, `<Name>` starts.
- [ ] Still signed in (userData renamed); theme kept (`rs-theme`); repo filter kept (`<name>.repoFilter`
      populated, old key removed); `~/.reviewstage` used as `ROOT` with the log line and doctor WARN.
- [ ] Old plist gone, new plist present, login item still on; `~/Applications/ReviewStage.app` gone,
      `<Name>.app` present.
- [ ] In-app updater path: with 1.0.2 running, "Check for updates" offers 1.1.0 → "Restart to update"
      → the shim forwards → `<Name>` is what comes back.
- [ ] Follow the doctor WARN (`mv` + `ln -s`); restart; everything still reads.

Docker boot
- [ ] `git clone https://github.com/Wimukti/<name> && cd <name> && cp .env.example .env && docker compose up -d`;
      `/health` ok; image `<name>:local`; volume `reviewstage-data` (unchanged name) holds `users.json`.
- [ ] Existing install: `git pull` on a checkout that still has the old remote URL (redirect works),
      `docker compose up -d --build`; previous `users.json`, `.env`, `skills/` all present; `bin/doctor.sh`
      recognises the Compose project via the updated `image:` regex.
- [ ] Webhook to a generic URL carries both `X-<Name>-Signature` and `X-ReviewStage-Signature` with equal values.

Desktop boot / phone pairing
- [ ] Enable phone access; QR scans; phone PWA installs as `<Name>` (manifest), offline page says `<Name>`;
      push notification title `<Name>`; VAPID `sub` is `https://<name>.dev` when `PUBLIC_URL` is not https.
- [ ] Phone paired before the rename (device token hashed on `RS_SECRET`) still opens after the upgrade.

Update check
- [ ] `desktop/update.js` hits `https://registry.npmjs.org/<name>`; `npm view reviewstage` shows the
      deprecation; `npx reviewstage --doctor` forwards and runs the new doctor.

Docs and links
- [ ] `https://reviewstage.dev/`, `/start/install/`, `/guides/notifications/`, a made-up path → land on
      `https://<name>.dev/<same path>`; `curl -sI https://reviewstage.dev/robots.txt` 200.
- [ ] `node website/scripts/verify-site.mjs` against `<name>.dev` green (titles, sitemap, og, install command).
- [ ] `https://github.com/Wimukti/reviewstage` → redirects; issue template links (advisories, discussions)
      resolve; README YouTube link plays the new video; social preview renders in a link unfurl.
- [ ] `scripts/brand-audit.sh openspec/changes/rename/allowlist.txt --quiet` exits 0 on `main`.
