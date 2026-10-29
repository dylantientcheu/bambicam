# Self-hosting

Docker Compose runs two small containers: Caddy serves the built app and proxies
`/relay` to Node. The relay has no public Docker port, database, or volume. Caddy
stores certificates in named volumes. The app and relay share one browser origin.

Compose builds default to **Same network**, with external STUN discovery off.
To enable discovery across networks by default, set
`BAMBICAM_STUN_URL=stun:stun.cloudflare.com:3478` in `.env` and rebuild the web
image. This is a build-time setting. You can also change the preference on the
baby phone before pairing; the pairing link carries it to the parent. Existing
remembered pairings keep their saved settings until replaced.

## Local smoke check

Install Docker with Compose, then:

```sh
git clone https://github.com/dylantientcheu/bambicam.git
cd bambicam
docker compose up --build -d
```

Open `http://localhost:8080` on this computer. The default port bindings accept
only loopback traffic. Localhost permits camera access; a phone opening an HTTP
LAN address does not. Use one of the HTTPS paths below for phones.

With Node dependencies installed, verify the same-origin relay:

```sh
npm ci
npm run smoke:relay -- ws://127.0.0.1:8080/relay
```

Stop with `docker compose down`. It keeps the certificate volumes. Avoid `down -v`
unless you intentionally want to delete those certificates and settings.

## Without internet on your home network

Both app delivery and signaling must run locally. A public deployment or
Tailscale setup is not, by itself, an internet-independent installation.
No service worker or offline app-shell cache is required or installed.

For a local Node setup, install the dependencies while online. Use a fixed LAN
address for the host and a certificate trusted by both phones. With
[mkcert](https://github.com/FiloSottile/mkcert) installed, replace `192.168.1.50`
below with your host's address:

```sh
npm ci
mkdir -p .certs
mkcert -install
mkcert -cert-file .certs/lan.pem -key-file .certs/lan-key.pem 192.168.1.50 localhost 127.0.0.1
VITE_STUN_URL='' HTTPS_CERT="$PWD/.certs/lan.pem" HTTPS_KEY="$PWD/.certs/lan-key.pem" RELAY_ALLOWED_ORIGINS='https://192.168.1.50:5173' npm run dev
```

Install and trust **only** the public `rootCA.pem` from `mkcert -CAROOT` on both
phones. On iOS, enable full trust for that installed root certificate in
Certificate Trust Settings. Never share `rootCA-key.pem` or `lan-key.pem`.
The `.certs` directory is ignored by Git. This is the existing development
server, exposed to your home network; do not forward its ports to the internet.

Open `https://192.168.1.50:5173` on both phones and select **Same network** in
Options → Advanced. Leave the same-origin relay address in place. Use a network
without guest/client isolation, and keep the host awake. If the host address
changes, update the certificate, allowed origin and URL.

Acceptance on your actual phones:

1. Disable mobile data on both phones and disconnect the router's internet uplink,
   leaving the home Wi-Fi and local host running.
2. Load the local HTTPS address afresh, pair and verify moving video and audible sound.
3. Reload the parent and reconnect. Switch media modes and confirm audible sound.
4. Restore the internet connection when finished.

Browser tests cover local pairing without STUN and survival of signaling outages.
They do not certify this physical network, certificate trust or overnight operation.

## Public HTTPS with Caddy

Use a machine reachable from the internet, a domain whose A/AAAA records point
to it, and inbound TCP ports 80 and 443. Remove an AAAA record if the machine
cannot actually accept IPv6. On a home router, this may require port forwarding;
carrier-grade NAT can prevent it.

Create a local `.env` (ignored by Git):

```dotenv
BAMBICAM_DOMAIN=monitor.example.com
BAMBICAM_BIND=0.0.0.0
BAMBICAM_ORIGINS=https://monitor.example.com
```

Run `docker compose up --build -d`, then open `https://monitor.example.com` on
both phones. Caddy obtains and renews the certificate. Keep its named volumes
across updates. Do not expose the relay's port 8787 separately.
Compose trusts only its Caddy ingress for source limits: Caddy overwrites
`X-Real-IP` with its TCP peer's address. Adding another proxy requires reviewing
that boundary. Otherwise all users behind it share one source limit.

## Private HTTPS with Tailscale

Install and sign in to Tailscale on the host and both phones. Keep Compose's
default loopback bindings; do not set the public-domain variables above.

```sh
docker compose up --build -d
tailscale serve --bg http://127.0.0.1:8080
tailscale serve status
```

Follow any Tailscale HTTPS setup prompt. Open the printed HTTPS address on both
phones. Serve restricts access to your tailnet; Funnel would expose it publicly
and is not needed here. See the [Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve).
Set `BAMBICAM_ORIGINS` in `.env` to that exact HTTPS origin, then rerun
`docker compose up -d` before pairing. Multiple trusted origins can be separated
by commas. When smoke-testing a custom origin, set `BAMBICAM_ORIGIN` to the same
value; the smoke client otherwise sends `http://localhost:8080`.

For development HTTPS or a tunnel, set `RELAY_ALLOWED_ORIGINS` on the Node relay
to the exact app origin. Direct Node operation ignores all forwarded IP headers
unless `RELAY_TRUST_PROXY=true` is explicitly set. Default development origins
are HTTP localhost/127.0.0.1 on ports 5173, 4173 and 8080, plus the hosted app
origin `https://bambi.cam`. Production should set only the origins it serves.

This provides private access to the web app and signaling, not a guarantee that
browser WebRTC can connect across every network. Start on the same Wi-Fi. You
can clear the STUN setting for LAN-only tests; keep STUN enabled when testing
different networks. No TURN fallback is provided. VPN transport relaying, if
used by Tailscale, is separate from a WebRTC TURN service.

The Compose path is exercised locally. The Tailscale recipe still needs validation
on a real tailnet and phones; it is not counted as a completed acceptance test.

## Updates and recovery

```sh
git pull --ff-only
docker compose up --build -d
docker compose ps
docker compose logs --tail=30
```

A web container update drops its proxied WebSockets; a relay update also drops
signaling. An established media connection is preserved while signaling retries,
as long as its direct path stays usable. Fresh pairing and recovery of failed
media still need the relay. Apply updates outside monitoring sessions and reload
both devices to use the new client behavior. To roll back, check out the previously tested
commit and rebuild. An already open app keeps its loaded frontend until refresh.

Keep exactly one relay replica: in-memory rooms are not shared. Test pairing,
audible sound, moving video, reconnects, and wake lock on the intended devices.
See [M1-ACCEPTANCE.md](M1-ACCEPTANCE.md) for the regression checklist.
