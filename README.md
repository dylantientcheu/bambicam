# bambicam

Two devices, one private live view. Leave a phone in the nursery as the **baby
unit** and use a second device as the **parent unit**. Video and microphone audio
travel directly between them over WebRTC. Nothing is recorded.

**Early release:** one baby unit, one parent. Night mode, live sound level, automatic
reconnection, optional remembered pairing, fullscreen/PiP, wake lock, and PWA
installation are implemented. The parent flags a frozen picture, both devices
show whether media travels directly on the local network or via STUN, and the
baby unit reacquires its camera after a system interruption. STUN enables direct connections across compatible
networks; no TURN media relay is used. M0/M1 physical acceptance is complete;
the hosted M2 rollout is in progress.

## Use Bambicam

Open **[bambi.cam](https://bambi.cam)** on both devices. The hosted pilot is live
over HTTPS. [Deployment instructions](docs/DEPLOYMENT.md) cover the hosting and
DNS setup.

1. Open the same address on both devices.
2. On the nursery phone, choose **Baby unit**, start the camera/microphone, and
   allow permissions. Keep it powered, visible, and unlocked.
3. Scan its QR with the other phone's camera, or choose **Parent unit** and scan
   inside the app. Confirm both moving video and audible sound.

Home Screen installation is optional. There are no cry/motion alerts or
guaranteed locked-screen playback. Some networks block direct media connections.

[Self-host with Docker or Tailscale](docs/SELF-HOSTING.md) ·
[Privacy](docs/PRIVACY.md) · [Security](docs/SECURITY.md) ·
[Contributing](CONTRIBUTING.md)

<p>
  <img src="docs/images/home.png" width="260" alt="Bambicam role selection">
  <img src="docs/images/parent.png" width="260" alt="Parent viewer showing synthetic video">
</p>

Screenshots use generated test video and contain no nursery footage or pairing code.

## Run locally

Use Node.js 22.12+ and npm. From this folder:

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The relay listens on `127.0.0.1:8787`; Vite
proxies `/relay` to it. One command starts both processes. The relay can also run
alone with `npm run dev:relay` (`HOST` and `PORT` configure its listener).

Localhost allows camera access on the development computer. A phone opening
`http://192.168.…:5173` needs **trusted HTTPS** instead.

## Try it on two phones

### Quick HTTPS tunnel for testing

For a short test without installing certificates on phones, use a
[Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
Run the live dev server and tunnel in separate terminals:

```sh
# Terminal 1
npm run dev

# Terminal 2 (requires cloudflared)
cloudflared tunnel --url http://127.0.0.1:5173 --http-host-header localhost:5173
```

Open the printed **https://…trycloudflare.com** address on **both devices**,
choose their roles, and pair there. The `/relay` WebSocket uses the same tunnel
automatically. The Host header option lets Vite accept the request without
disabling its host checks. `localhost` on a phone refers to that phone, not the
development computer.

Code changes are served immediately through the dev server; Vite refreshes the
connected pages as needed. Port 4173 is a separate production preview: it serves
the last build, so it does not pick up source edits until `npm run build` runs again.

Start with both devices on the same Wi-Fi. To test Wi-Fi to cellular, both must
use the public tunnel URL and have STUN enabled. STUN can establish direct media
across compatible networks; some networks still require TURN, which is outside
v1. The tunnel itself provides HTTPS and signaling. Cloudflare serves the app and forwards
encrypted signaling; WebRTC audio/video still travels directly between peers.
Cloudflare is an additional trusted web intermediary for this test. The tunnel
URL is public; accessing a live stream also requires its separate pairing secret.
Stop `cloudflared` with Ctrl+C when finished. The temporary URL then stops
working, and the next tunnel gets a new address. No production deployment or
Cloudflare account is needed.

### Local HTTPS without a tunnel

1. Connect the development computer and both phones to the same Wi-Fi. Use a
   network that permits devices to communicate; guest/client-isolated networks
   may prevent WebRTC connections.
2. Install [mkcert](https://github.com/FiloSottile/mkcert) and create a local
   certificate. Replace the example IP with the computer's current LAN IP:

   ```sh
   mkcert -install
   mkdir -p .certs
   mkcert -cert-file .certs/localhost.pem -key-file .certs/localhost-key.pem localhost 127.0.0.1 ::1 192.168.1.42
   ```

3. Install the **public** `rootCA.pem` from `mkcert -CAROOT` on both phones.
   On iOS, install the profile and enable full trust in certificate settings.
   Follow [mkcert's mobile instructions](https://github.com/FiloSottile/mkcert#mobile-devices)
   for your device. Never copy or share `rootCA-key.pem`.
4. Start the dev server from this folder:

   ```sh
   HTTPS_CERT="$PWD/.certs/localhost.pem" HTTPS_KEY="$PWD/.certs/localhost-key.pem" npm run dev
   ```

5. Open **https://192.168.1.42:5173** on the baby phone. The certificate must be
   trusted without a warning. Choose **Baby unit**, tap **Start camera &
   microphone**, and allow both permissions.
6. On the parent phone, scan the QR with the system camera and open its link.
   Alternatively open the exact same URL, choose **Parent unit**, and use the
   built-in scanner or paste the pairing link. A valid code connects directly
   to the feed; no additional Connect step is needed.
7. Confirm video changes as you move in front of the baby camera, and that you
   can hear sound on the parent. Tap **Play video & sound** if autoplay is
   blocked. Separate the devices to avoid feedback.
8. Tap **Stop & go back** to end the session and release camera/microphone
   capture. **New pairing code** disconnects the old parent and changes the
   secret and room. An unused code rotates after ten minutes.

Allow incoming connections to port 5173 on the development computer if its
firewall asks. The baby keeps its pairing through temporary network failures.
Restarting its page or creating a new code requires another scan. The parent
does not request microphone access. Scanning only
uses its camera, which is released as soon as a code is read or scanning stops.

## Relay settings

The default relay URL is derived from the web page's origin (`/relay`). Open
**Options → Advanced** before starting to change it. An HTTPS page requires a
`wss://` relay. A custom relay address is included in the pairing URL fragment
so the second device uses the same one; inspect it in **Options → Advanced**.
The build can also set `VITE_RELAY_URL`. Settings stay in memory unless the
parent explicitly chooses to remember the pairing.

**STUN server (optional)** defaults to `stun:stun.cloudflare.com:3478`.
[Cloudflare documents this endpoint](https://developers.cloudflare.com/realtime/turn/)
and its [free public STUN service](https://developers.cloudflare.com/realtime/turn/faq/).
Use another `stun:host:port` endpoint or leave it blank for LAN only. A build can
set `VITE_STUN_URL`, including an empty value. The pairing fragment carries this
setting to the parent, where it can be inspected in **Options → Advanced**. STUN receives
IP addresses and discovery packets, never media; it can be contacted even if the
chosen media route is on the same Wi-Fi. No TURN URL or credentials are accepted.

The relay has no database. It accepts two sockets per 128-bit room ID, forwards
only binary frames once joined, and deletes empty rooms. It bounds message
size, message rate, room count, join time, and slow-client buffering, with a
heartbeat to clean up broken sockets. It does not authenticate who joins a
room; the encrypted challenge authenticates peers in the browsers. It is a
bounded signaling service. It also limits total connections, upgrade bursts, and
bytes per second; these controls do not make it immune to denial of service.

## Parent viewing and installation

The parent player has custom **Full screen** and **Picture in Picture** icons
over the video. Controls fade after inactivity and return on touch, mouse movement,
or keyboard focus. The whole camera frame stays visible; there is no fit/fill
toggle. Unsupported PiP is omitted. Turn the phone to change orientation; the
layout follows the viewport without reconnecting. On iPhone, Portrait Orientation
Lock must be off to rotate. On iPhone, **Expand view** fills the page and keeps
the video inline to avoid the native fullscreen-to-PiP handoff reported to freeze
the phone UI. Safari's address bar may remain visible. Other browsers use native
fullscreen where supported, with expanded page view as a fallback. A disconnected session clears
the remote video and closes native PiP/fullscreen instead of leaving a frozen
image looking live.

PiP uses Safari's per-video presentation support check as well as the standard
API on other browsers. It is unavailable for some browser/live-stream
combinations. In particular, iOS Home Screen apps have a
[reported PiP limitation](https://bugs.webkit.org/show_bug.cgi?id=303885), even
when the same page works in Safari. Try Safari if PiP is your priority. The
Safari API path is covered by simulated browser tests; actual iPhone PiP still
varies by device and should be checked on your setup.

On iPhone, open **Options → Add to Home Screen** for instructions: **Safari → Share → Add to Home
Screen**, keeping **Open as Web App** enabled if offered. On browsers supporting
an install prompt, the button opens it. Then launch the installed app, choose
Parent unit, and scan the baby code inside that app. Choose **Remember this baby
unit** inside the installed app if desired; do not assume Safari and the Home
Screen app share saved pairings. A stable HTTPS origin is needed for a
lasting installation: a temporary tunnel address stops connecting when its
process ends.

Home Screen installation is optional. The manifest and icons remain, but the
app registers no service worker and keeps no offline app cache. Opening it needs
a network connection; live monitoring also needs a reachable relay and peer.
Normal browser HTTP caching still applies. Serve HTML with revalidation so
opening or refreshing loads the current build. An active production session is
never forcibly reloaded to apply an update, and there is no update button or notification.

The app removes its legacy worker and offline caches without clearing remembered
pairings or other apps' data. A small retirement script stays at the old `sw.js`
address so previously installed workers can also clean themselves up without a
reload. If an old installation still opens a cached version, stop monitoring and
open the same address with `?refresh=1` appended once. That bypasses the previous
worker's navigation cache and loads the current app. No Safari data clearing is needed.

### Foreground and network limits

- **Baby unit:** keep the page visible and the device unlocked. The OS can
  interrupt camera/microphone capture when the app is backgrounded or locked.
- **Parent unit:** PiP can permit multitasking when the browser supports this
  stream. Locked-screen or suspended-app playback is not guaranteed. Installing
  a PWA does not grant native background media privileges.
- **Screen wake lock:** requested while a session is active, released on stop,
  and requested again when the page becomes visible. The browser or Low Power
  Mode can refuse it; the UI reports when it cannot keep the screen awake.
- **Different networks:** STUN enables direct connections where NAT/firewalls
  allow them, provided the app and relay are reachable by both devices. Some
  cellular and guest networks block direct connections. The app reports the
  failure and keeps retrying; use the same Wi-Fi or a network that permits device
  communication. There is no TURN fallback. A local-only app/relay address remains
  unreachable from cellular even with STUN enabled.

References: [Safari PiP](https://developer.apple.com/documentation/webkitjs/adding_picture_in_picture_to_your_safari_media_controls),
[PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[screen wake lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API),
[WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols).

## Night mode, reconnecting, and remembered pairing

The baby screen dims to near black 15 seconds after a connection becomes live.
The moon icon (**Dim screen**) enters it immediately; tapping anywhere or pressing Escape shows
controls. Capture and wake lock stay active. A lost connection exits night mode
so the status remains visible. This dims the page, not the hardware backlight.

The small equalizer in the lower corner shows incoming microphone level,
including in the expanded player. Analysis stays in memory; only the video element plays sound.
If Safari suspends audio analysis, tap the sound icon (**Enable sound meter**). A sound level is
not an alert, and the meter does not establish that the speaker is audible.

Both devices reconnect automatically after relay loss or a failed media path.
An interrupted media path has an eight-second recovery window; a failed path or
25-second handshake timeout rebuilds the connection. Relay retries back off from
roughly one to fifteen seconds. Peer departures clear the old stream and wait for
the same pairing to return. Every new peer connection uses a fresh encrypted
challenge, so retaining the pairing does not permit old handshake replay. Stopping
cancels retries and releases remote media; stopping the baby also releases capture.
Invalid authenticated signaling ends the session and requires an explicit retry.

**Remember this baby unit** is opt-in in Options while
watching. Saved-pairing information stays out of the live view. It saves the pairing secret,
relay, and STUN setting in this origin's `localStorage`; there is no account or
server storage. Reloading offers **Connect to baby** without rescanning. **Options → Forget
baby unit** removes the saved pairing and stops this parent's session. The baby
never persists its secret. An unused code expires after ten minutes; once paired,
it stays valid through interruptions until the baby restarts or creates a new
code. Treat a remembered device as having access for that lifetime.

## Checks

```sh
npm run check                # TypeScript, crypto/relay tests, production build
npx playwright install chromium
npm run test:e2e             # Browser pairing and WebRTC with synthetic media
```

The Options sheet also holds installation, help, pairing actions, and advanced
connection diagnostics. Normal monitoring has no visible connection badge;
interruptions and frozen video still appear directly over the picture. Screen
readers continue receiving connection status. Wake lock is automatic, with a
compact expandable warning only when the screen may sleep.

To test the production build, run `npm run build`, start the relay, and run
`npm run preview -w web -- --port 4173 --strictPort`. Then use
`BAMBICAM_TEST_URL=http://localhost:4173 npm run test:e2e`. This also exercises
the viewing controls, night mode, sound/silence, saved-pairing reload/forget,
repeated transport drops, ICE failure, offline recovery, and occupied rooms
against the production build. Installation tests verify that no new offline cache
is created and that legacy cleanup preserves pairings and live video. Browser
tests use real WebRTC with synthetic media; they do not prove iPhone background
behavior or overnight reliability. The manual
acceptance steps are in [docs/M1-ACCEPTANCE.md](docs/M1-ACCEPTANCE.md).

`npm run build` writes the static web build to `web/dist`. Serve that directory
over HTTPS and reverse-proxy `/relay` to the relay for a deployed setup. The
Docker Compose setup serves both roles with Caddy and a separate relay container.
See [self-hosting](docs/SELF-HOSTING.md) and [hosted deployment](docs/DEPLOYMENT.md).

## Privacy and protocol

- No accounts, recording, analytics, runtime third-party scripts, or offline app
  cache. Pairing storage is opt-in on the parent, with a **Forget baby unit** control.
- Media uses direct WebRTC. STUN defaults to Cloudflare and is configurable or
  disabled; its operator sees IP addresses. No TURN media relay is configured.
- The QR contains a random 256-bit secret in the URL fragment, never a URL query.
  The app removes the fragment from the current history entry when opened.
- HKDF derives a public room ID and a private AES-256-GCM signaling key.
  Fresh session challenges and authenticated counters reject replayed signals.
- The relay sees IPs, room IDs, connection timing, frame lengths, and ciphertext.
  Encryption does not prevent it from denying service. The web host also sees
  normal requests for static files. Whoever controls the web app's served code
  remains trusted; this implementation has not had an independent security audit.
- Treat a pairing QR/link like a password. Anyone holding it can attempt to
  connect until the baby unit rotates it. Copying a link deliberately places it
  on the device clipboard, which may have its own history/sync behavior.

The wire format and freshness check are documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).
See [PLAN.md](PLAN.md) for scope and future milestones. Bambicam is licensed
under [MIT](LICENSE); dependency licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
