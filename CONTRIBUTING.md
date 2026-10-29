# Contributing

Use Node.js 22.12+ and npm (CI uses Node.js 24). Install dependencies with `npm ci`, then run
`npm run dev`. Keep changes small and describe the behavior they change.

Before submitting a pull request:

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

If this machine cannot reliably route WebRTC between isolated browser contexts,
`BAMBICAM_TEST_LOOPBACK=1 npm run test:e2e` enables loopback ICE interfaces,
disables Chromium's mDNS address masking and grants synthetic camera/microphone
permission to both contexts so those interfaces can be enumerated. Media still
uses real ICE/DTLS/SRTP. This test profile does not validate phone permissions,
LAN routing or mDNS; keep the normal run and physical-device checklist as the
default acceptance paths. The app itself is unchanged by this test setting.

For hosting changes, build both Dockerfiles and follow the smoke checks in
[SELF-HOSTING.md](docs/SELF-HOSTING.md). Add focused regression tests for changes
to authentication, connection limits, cleanup, or reconnect behavior. Never use
real nursery footage or live pairing links in tests, screenshots, or issues.

Runtime assets must remain local: no analytics, external fonts, third-party
scripts, or media uploads. Changes to the protocol must update
[PROTOCOL.md](docs/PROTOCOL.md) and explain compatibility.

## Testing on phones

Phones need trusted HTTPS for camera access. For a temporary development URL,
run `npm run dev`, then in another terminal with `cloudflared` installed:

```sh
cloudflared tunnel --url http://127.0.0.1:5173 --http-host-header localhost:5173
```

Open the printed HTTPS URL on both phones. Cloudflare serves the app and forwards
encrypted signaling; media remains direct. The URL is public and temporary.
Stop the tunnel when finished. For local HTTPS, provide trusted certificate paths
as `HTTPS_CERT` and `HTTPS_KEY` to `npm run dev`; keep private keys out of Git.

Follow the [device checklist](docs/M1-ACCEPTANCE.md) for manual validation.

## License and security

By contributing, you agree that your contributions are licensed under the
project's [MIT license](LICENSE). Report security problems privately using
[SECURITY.md](SECURITY.md).
