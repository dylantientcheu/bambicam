<h1 align="center">
  <img src="web/public/favicon.svg" alt="" width="64" height="64">
  <br>
  bambicam
</h1>

Two devices, one private live view. Leave a phone in the nursery as the **baby
unit** and use another device as the **parent unit**. Audio and video travel
directly between them over encrypted WebRTC. Nothing is recorded.

Open source under the [MIT license](LICENSE). Run the app and connection service
on your own infrastructure, including your home network; no Bambicam account or
hosted service is required for a locally hosted setup.

**[Open bambi.cam](https://bambi.cam)** · [Self-host](docs/SELF-HOSTING.md) ·
[Privacy](docs/PRIVACY.md) · [Contribute](CONTRIBUTING.md)

## Get started

1. Open Bambicam on the nursery phone, choose **Baby unit**, and allow camera
   and microphone access.
2. Scan its QR code with the parent phone, or choose **Parent unit** and scan
   inside the app.
3. Confirm moving video and audible sound. Keep the baby phone powered,
   visible, and unlocked.

The app includes night mode, a sound meter, automatic reconnection, optional
remembered pairing, fullscreen, and picture-in-picture where supported.
Use **Options → Add to Home Screen** for installation instructions.

Choose **Monitoring mode** on the baby phone before starting, or in **Options**
while monitoring: full video, reduced video (up to 640 × 360 at 10 fps), or
**Audio only**. Audio only stops the camera and video transmission while keeping
the microphone on. Modes never change automatically. Browser background and
locked-screen limits still apply to audio-only monitoring.

<p>
  <img src="docs/images/home.png" width="260" alt="Bambicam role selection">
  <img src="docs/images/parent.png" width="260" alt="Parent viewer showing synthetic video">
</p>

Screenshots use synthetic video, with no nursery footage or pairing code.

## Local operation and outages

Wi-Fi does not require an internet connection. To start and restart sessions
without internet, host both the app and signaling relay on your home network,
use trusted HTTPS on the phones, and select **Options → Advanced → Connection
preference → Same network**. This disables STUN discovery; it does not change
the app host or relay address. Docker Compose builds default to this preference.
See [local hosting](docs/SELF-HOSTING.md#without-internet-on-your-home-network).

Once paired, an established direct stream stays open during a signaling outage
as long as the media connection still works. Connection setup retries in the
background. This can preserve local monitoring through an internet outage;
losing Wi-Fi itself, closing a browser, or reloading still requires recovery.
**New pairing code** and **Stop** still close the current media connection.

The connection details distinguish the media route from the app host and relay.
Local media alone does not mean the hosted app has no internet dependencies.

## Know the limits

- This is an early release for one baby unit and one parent. There are no
  cry/motion alerts or recordings.
- Baby capture needs the page visible and the device unlocked. Parent background
  audio, picture-in-picture, and wake lock depend on the browser and OS.
- Start on the same Wi-Fi. Some networks block direct connections; there is no
  TURN media relay fallback.
- Treat the pairing QR/link like a password. **New pairing code** revokes the old
  code; **Forget baby unit** removes a pairing saved on the parent.

The signaling relay forwards encrypted connection messages, not media. It can
see connection metadata and disrupt service. The web host supplies the app code
and remains trusted. See the [security model](docs/SECURITY.md) and
[protocol](docs/PROTOCOL.md) for details; there has been no independent audit.

## Develop locally

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. This starts the web app and relay together. Phones
need trusted HTTPS; see [device testing](CONTRIBUTING.md#testing-on-phones).

```sh
npm run check      # TypeScript, unit tests, production build
npm run test:e2e   # Browser tests; install Chromium as described in CONTRIBUTING.md
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for test setup,
[DEPLOYMENT.md](docs/DEPLOYMENT.md) for Railway hosting, and [PLAN.md](PLAN.md)
for the roadmap.

Licensed under [MIT](LICENSE). Dependency licenses are retained in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
