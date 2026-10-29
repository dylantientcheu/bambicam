# Roadmap

## M0 — pair and stream · complete

- [x] Pair two devices by QR and authenticate encrypted signaling.
- [x] Stream direct WebRTC audio/video, with at most two peers per room.
- [x] Acceptance: two physical phones stream on the same Wi-Fi after one scan.

## M1 — daily use · complete

- [x] Night mode, sound meter, wake lock, fullscreen and supported PiP.
- [x] Reconnect automatically and recover from camera interruptions.
- [x] Optional remembered pairing, configurable STUN, and Home Screen installation.
- [x] Show connection failures and frozen video clearly.
- [x] Acceptance: overnight use without intervention, confirmed by the maintainer.

Keep the [device checklist](docs/M1-ACCEPTANCE.md) for regression testing.

## M2 — public release · in progress

- [x] Publish the MIT-licensed repository with CI, screenshots, and essential docs.
- [x] Deploy separate web/relay services and verify pairing at `bambi.cam`.
- [x] Require passing CI for GitHub deployments.
- [x] Harden relay resource limits and add production headers.
- [x] Provide Docker self-hosting; test Compose on arm64 and builds on amd64.
- [ ] Complete the `relay.bambi.cam` certificate; Railway's WSS hostname works meanwhile.
- [ ] Verify Compose pairing on amd64 and private Tailscale hosting on real devices.
- [x] Complete hosted restart recovery, resource measurements, and an eight-hour device run.

Done when a new user can pair through the hosted app and self-host in ten minutes
once Docker and DNS or Tailscale prerequisites are ready.

## Next

Local operation improvements:
- [x] Preserve established media during signaling outages; retry setup separately.
- [x] Manual audio-only and reduced-video modes, with continuous microphone capture.
- [x] Same-network preference, STUN-off Compose defaults, and explicit hosting limits.
- [ ] Complete physical-device outage/mode/local-start checks in [the checklist](docs/M1-ACCEPTANCE.md).

- **M3:** on-device sound/motion alerts, with explicit browser/background limits.
- **M4:** explore on-device computer vision without uploading frames.
- **Later:** push-to-talk, multiple parents with approval, optional user-operated
  TURN, and native background audio.

No accounts, analytics, or media uploads are planned. The current app's
[privacy](docs/PRIVACY.md) and [security](docs/SECURITY.md) limits remain explicit.
