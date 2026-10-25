# Self-hosting

Docker Compose runs two small containers: Caddy serves the built app and proxies
`/relay` to Node. The relay has no public Docker port, database, or volume. Caddy
stores certificates in named volumes. The app and relay share one browser origin.

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

## Public HTTPS with Caddy

Use a machine reachable from the internet, a domain whose A/AAAA records point
to it, and inbound TCP ports 80 and 443. Remove an AAAA record if the machine
cannot actually accept IPv6. On a home router, this may require port forwarding;
carrier-grade NAT can prevent it.

Create a local `.env` (ignored by Git):

```dotenv
BAMBICAM_DOMAIN=monitor.example.com
BAMBICAM_BIND=0.0.0.0
```

Run `docker compose up --build -d`, then open `https://monitor.example.com` on
both phones. Caddy obtains and renews the certificate. Keep its named volumes
across updates. Do not expose the relay's port 8787 separately.

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
signaling. The app reconnects, but expect a visible interruption. Apply updates
outside monitoring sessions. To roll back, check out the previously tested
commit and rebuild. An already open app keeps its loaded frontend until refresh.

Keep exactly one relay replica: in-memory rooms are not shared. Test pairing,
audible sound, moving video, reconnects, and wake lock on the intended devices.
See [M1-ACCEPTANCE.md](M1-ACCEPTANCE.md) for the regression checklist.
