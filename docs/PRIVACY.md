# Privacy

Bambicam does not record audio/video or upload media to its hosting services.
The two devices exchange live media directly over encrypted WebRTC. No account,
advertising, analytics, or runtime third-party scripts are used by the app.

## What leaves a device

| Destination | Data it receives |
| --- | --- |
| Other paired device | Live audio/video; authenticated connection messages |
| Static web host | Normal HTTPS requests for app files, including IP and request metadata |
| Signaling relay and its hosting edge | Encrypted signaling plus room IDs, public envelope headers, timing, sizes, and connection metadata |
| Configured STUN operator | IP addresses and connectivity-discovery packets; no media |

The hosted pilot uses Railway for the static app and signaling relay. Cloudflare
provides the default public STUN endpoint. STUN can be contacted even if the chosen
media route is on the same Wi-Fi. It can be changed or disabled in **Options →
Advanced**. The relay is also replaceable. A blank STUN setting does not disable
the web host or signaling connection.

The pairing secret is placed in a URL fragment, not a query string, and is not
sent to hosting servers by the browser's HTTP request. The app reads and removes
that fragment. Deliberately copying or sharing a pairing link exposes the secret
to the clipboard or application used to share it.

## Storage and logs

- The baby keeps its secret and media in memory while running. It does not save
  recordings or persist the pairing secret.
- **Remember this baby unit** stores a secret and connection settings in the
  parent's localStorage, only after opt-in. **Forget baby unit** deletes that
  entry. Clearing site data also removes it. Storage belongs to that app origin
  and may differ between Safari and an installed Home Screen app.
- Remembered keys are not encrypted at rest. Someone with access to the unlocked
  browser or an extension with site access may read them. Forgetting only removes
  the local copy; **New pairing code** on the baby revokes all old copies.
- The relay keeps rooms/sockets in memory, deletes empty rooms, and has no
  database or persistent volume. It has no application logging of payloads,
  room IDs, pairing secrets, SDP, ICE candidates, or individual requests. Caddy
  access logging is not enabled in the supplied configuration.
- Source abuse counters use IPv4 addresses or IPv6 /64 prefixes only in memory,
  without logging them. Entries expire after the one-minute rate window once no
  associated connections or rooms remain (cleanup runs every 30 seconds).
- Hosting providers can collect connection/request metadata independently of
  application logs. Railway exposes HTTP logs, including client IP, path,
  status and timing. Retention depends on provider policy and account settings;
  this project does not promise provider-level zero logging or a fixed deletion
  period. See [Railway's privacy policy](https://railway.com/legal/privacy) and
  [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- Browser HTTP caching still applies. The app creates no offline application
  cache and registers no service worker. Its retirement script removes older
  Bambicam workers/caches without clearing remembered pairings.

No media relay (TURN) is configured. If direct connectivity fails, Bambicam reports
the failure and retries. Self-hosting changes who operates the web host/relay;
it does not make devices, browsers, or the software automatically trustworthy.

See the [security model](SECURITY.md) for threats and limitations.
