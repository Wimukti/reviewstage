# Web push — the proof only a phone can give

Everything below the line is automated (encryption round-trips against an independent decrypt,
the RFC 8291 test vector, the VAPID JWT, the routes, the worker). What no test can prove is that
a real push service accepts our sends and a real phone shows them. That takes a device. These
are the exact steps on the maintainer's test box.

## Before you start

- The test box is reachable over **https** (push subscriptions need a secure context — a
  Tailscale/Caddy hostname is fine; `http://<ip>:8899` is not).
- The phone can open that URL.
- The image was rebuilt from this branch: it now installs Python `cryptography`.

## Steps

1. Deploy:

   ```sh
   cd ~/Desktop/rs-test && git pull && docker compose --profile team up -d --build
   ```

2. Health:

   ```sh
   docker compose exec app doctor | grep push
   ```

   Expected before anyone has enabled a device:
   `WARN  push: no VAPID pair — notifications off until someone enables them on a device`.
   No `WARN push: python3 cannot import cryptography` line (that would mean the image was not
   rebuilt).

3. **On the phone**, open the dashboard URL in the browser and sign in.
   - **iPhone/iPad:** Share → **Add to Home Screen**, then open ReviewStage **from that icon**.
     In a Safari tab the Settings panel shows *"Add to Home Screen first — Safari only delivers
     push to installed apps"* instead of the switch; that hint is correct, not a bug.
   - **Android:** Chrome's "Install app" is nice but optional; a tab works too.

4. **Settings → Notifications on this device** → turn the switch **on** → allow notifications
   when the OS asks. The device appears in the list below as e.g. `iPhone · Safari` with the
   badge **This device**.

5. Tap **Send a test**. Within a few seconds the phone shows:

   > **ReviewStage test**
   > This is what a review request looks like.

   Tapping it opens the app on `/`. The panel says *"Sent to 1 device — check your
   notifications."*

6. Back on the box:

   ```sh
   docker compose exec app doctor | grep push
   ```

   Now `PASS  push: VAPID pair present (/home/reviewstage/.reviewstage/push_vapid.json)`.

7. **The real thing.** Ask for your review on any PR the box watches (or re-request it). When
   the poller's next cycle (or the GitHub webhook) notices, the phone shows:

   > **Review requested: owner/name#123**
   > <the PR title>

   Tapping it opens that PR's review page. The poller log has no `WARN: push:` line:

   ```sh
   docker compose logs --since 10m poller | grep -i push
   ```

8. Second device, optional: repeat 3–5 on a laptop browser. Both devices receive the test; the
   list shows both; the trash button on one removes it from the other's list after a reload.

9. Revocation path: on the phone, remove the app (or revoke notifications in Settings → the
   app). Tap **Send a test** from the laptop. The server log shows
   `WARN: push: web.push.apple.com/…: is gone (410) — subscription removed` and the phone
   disappears from the list on the next reload.

## What to report back

- Platform + browser the push arrived on (e.g. *iPhone 15, iOS 17.5, home-screen app*).
- Whether step 7's notification arrived and opened the right PR page.
- Any `WARN: push:` lines from the poller or app logs.

## If it does not arrive

| Symptom | Cause |
| --- | --- |
| Switch is disabled, panel says "cannot receive push" | Not a secure context (http), or an unsupported browser. |
| iOS shows the "Add to Home Screen" hint | Opened in a Safari tab; open from the home-screen icon. |
| Permission prompt never appears on iOS | The app was installed before this build; remove and re-add it so Safari re-reads the manifest. |
| `WARN: push: … answered 403` | The VAPID pair changed since the device subscribed (keys rotated). Turn notifications off and on again on the device. |
| `WARN: push: … answered 403` on `web.push.apple.com` | Apple rejected the JWT (`BadJwtToken`). The usual cause is a `localhost` contact in `sub`; the server never sends one now, so check `VAPID_SUBJECT` is a real `mailto:` or `https:` address. |
| `WARN: push: … answered 401/400` | `VAPID_SUBJECT` is not a `mailto:`/`https:` URL, or the system clock is far off (the JWT's `exp` is checked). |
| Nothing in the log, nothing on the phone | The poller did not run (`--profile team`), or the request was for a different GitHub login than the one signed in on the phone. |
