# Contributing

Use Node.js 24.15+ and npm. Install dependencies with `npm ci`, then run
`npm run dev`. Keep changes small and describe the behavior they change.

Before submitting a pull request:

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

For hosting changes, build both Dockerfiles and follow the smoke checks in
[SELF-HOSTING.md](docs/SELF-HOSTING.md). Add focused regression tests for changes
to authentication, connection limits, cleanup, or reconnect behavior. Never use
real nursery footage or live pairing links in tests, screenshots, or issues.

Runtime assets must remain local: no analytics, external fonts, third-party
scripts, or media uploads. Changes to the protocol must update
[PROTOCOL.md](docs/PROTOCOL.md) and explain compatibility.

By contributing, you agree that your contributions are licensed under the
project's [MIT license](LICENSE). Report security problems privately using
[SECURITY.md](SECURITY.md).
