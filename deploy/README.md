# Putting ReviewStage on a URL

`docker compose up -d` publishes the dashboard on **`127.0.0.1:8899` only**. That is the right
default for a laptop. For a team you need a URL other people can open, and it must be HTTPS:
session cookies carry the `Secure` flag, and reviewers paste GitHub and Claude tokens into it.

Three ways, in increasing order of ceremony. Whichever you pick, set `PUBLIC_URL` in `.env`
to the URL people will actually open and `docker compose up -d` again — Slack buttons and the
GitHub OAuth callback are built from it.

## Caddy (public hostname, automatic certificates)

[`caddy/Caddyfile`](caddy/Caddyfile) is a complete example. Caddy obtains and renews the
Let's Encrypt certificate itself; all you need is a DNS record pointing at the host and ports
80/443 open.

```bash
sudo apt install caddy                              # or brew install caddy
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile   # edit the hostname first
sudo systemctl reload caddy
```

Then in `.env`: `PUBLIC_URL=https://reviewstage.example.com`.

Anyone on the internet can reach the login page. That is how the dashboard was designed to
run — every link is HMAC-signed, every action needs a session — but read
[`../docs/SECURITY.md`](../docs/SECURITY.md) before you flip `DRY_RUN=0`.

## Tailscale Serve (private to your tailnet, zero config)

If everyone who needs the dashboard is on the same tailnet, this is the least work and
nothing is exposed to the internet at all:

```bash
tailscale serve --bg 8899
```

Tailscale terminates TLS with a certificate for `<machine>.<tailnet>.ts.net` and proxies to
`127.0.0.1:8899`. Set `PUBLIC_URL=https://<machine>.<tailnet>.ts.net` in `.env`.

`tailscale funnel 8899` is the same command exposed publicly, if you want the Caddy result
without running Caddy.

## Cloudflare Access (public hostname, identity in front)

Put a Cloudflare Tunnel in front and gate it with an Access policy (your Google Workspace /
GitHub org / email domain). Reviewers then pass Cloudflare's login before they ever see
ReviewStage's own sign-in.

```bash
cloudflared tunnel create reviewstage
cloudflared tunnel route dns reviewstage reviewstage.example.com
cloudflared tunnel run --url http://127.0.0.1:8899 reviewstage
```

Then Zero Trust dashboard → Access → Applications → add `reviewstage.example.com` with a
policy for your team. Set `PUBLIC_URL=https://reviewstage.example.com`.

Access sits in front of everything, including the health endpoint — if you monitor `/health`
from outside, add a bypass rule for that path or a service token.

## The GitHub webhook path

If you turn on GitHub webhooks (`GITHUB_WEBHOOK_SECRET`, see
[`../docs/INSTALL-DOCKER.md`](../docs/INSTALL-DOCKER.md#instant-updates-github-webhooks)),
GitHub's servers must be able to `POST` to exactly one path:

```
<PUBLIC_URL>/webhooks/github
```

Everything else can stay private. The path authenticates itself — every delivery carries an
HMAC over the body that the server checks before doing anything — so it is safe to expose on
its own while the dashboard stays behind your identity layer.

- **Caddy / public hostname**: nothing to do; the path is already reachable.
- **Tailscale Serve**: GitHub is not on your tailnet. Either `tailscale funnel` the whole
  dashboard, or run a second public entry (Caddy, a Cloudflare Tunnel) that proxies **only**
  `/webhooks/github` to `127.0.0.1:8899`. With Caddy: `handle /webhooks/github { reverse_proxy 127.0.0.1:8899 }` and `respond 404` for everything else on that hostname.
- **Cloudflare Access**: Access would present GitHub with a login page (a 302, which GitHub
  reports as a failed delivery). Add a **Bypass** policy for the path: Zero Trust → Access →
  Applications → your app → *Add an application* (or a second application) for
  `reviewstage.example.com/webhooks/github` with a policy action *Bypass* → *Everyone*. The
  health path can join it if you monitor `/health` from outside.

Verify from the GitHub side: the webhook's *Recent Deliveries* tab shows a `200` for the ping
and `202` for events. A `503` means the secret is not set on the server, a `401` that the two
secrets differ, a `302`/timeout that the proxy or Access policy is still in the way. Polling
keeps the queue correct throughout.

## The GitHub OAuth callback

If you configure one-click **Sign in with GitHub** (`GH_CLIENT_ID` / `GH_CLIENT_SECRET`, see
[`../docs/SETUP.md`](../docs/SETUP.md#team-pilot)), the OAuth App's *Authorization callback
URL* must be exactly:

```
<PUBLIC_URL>/oauth/callback
```

for example `https://reviewstage.example.com/oauth/callback`. GitHub compares the callback
byte-for-byte with what the server sends, so the value must match `PUBLIC_URL` exactly.

Whatever proxy you use must pass the path through unchanged (no prefix stripping) and forward
the `Host` header, so the cookie domain and redirect URLs match `PUBLIC_URL`.
