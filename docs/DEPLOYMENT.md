# Railway deployment

Build both services from the repository root; npm workspaces share a lockfile.
No database or persistent volume is needed. Railway terminates HTTPS/WSS.

| Setting | Relay | Web |
| --- | --- | --- |
| Dockerfile | `relay/Dockerfile` | `docker/web.Dockerfile` |
| Domain | `relay.bambi.cam` | `bambi.cam` |
| Explicit `PORT` and domain target port | `8787` | `8080` |
| Healthcheck | `/health` | `/health` |
| Region / replicas | Europe / 1 | Europe / 1 |
| Sleeping | Disabled | Disabled |
| Resource limit | 1 vCPU / 0.5 GB | 1 vCPU / 0.5 GB |
| Restart | On failure, up to 5 retries | On failure, up to 5 retries |

Relay variables: `HOST=0.0.0.0`, `NODE_ENV=production`,
`RELAY_ALLOWED_ORIGINS=https://bambi.cam`, `RELAY_TRUST_PROXY=true`.
The origin list is comma-separated and must contain exact origins without paths.
Proxy mode uses Railway's `X-Real-IP` for in-memory source limits. Enable it only
with ingress restricted to the trusted edge that overwrites that header; no TCP
proxy or direct public relay port. Verify that incoming client-supplied headers
cannot override it before rollout. `X-Forwarded-For` is deliberately ignored.
For a multi-proxy route, verify the whole chain rather than trusting arbitrary
forwarded headers. See [Railway request headers](https://docs.railway.com/quick-start.md).
Web variables: `SITE_ADDRESS=:8080`, `RELAY_UPSTREAM=relay.railway.internal:8787`,
and build variable `VITE_RELAY_URL=wss://relay.bambi.cam/relay`.
Use the generated Railway WSS hostname until the custom relay certificate works.
Changing `VITE_RELAY_URL` requires rebuilding the web app.

Keep **one relay replica**, deployment overlap at 0 seconds, and draining at
5 seconds: rooms live in one process. Relay releases interrupt sessions while
clients reconnect. Frontend releases use a separate service.

## Releases

Both services follow `dylantientcheu/bambicam`, branch `main`, with **Wait for CI**
enabled. Push or merge to `main`; passing GitHub checks allow deployment.

- Relay watch paths: `relay/**`, `package.json`, `package-lock.json`, `.dockerignore`.
- Web watch paths: `web/**`, `docker/**`, `package.json`, `package-lock.json`, `.dockerignore`.
- Documentation-only changes do not deploy either service.

Service settings are managed in Railway. Build allowlists exclude local secrets
and artifacts. To roll back, redeploy a previous successful deployment.

Repository hardening still needs administrator configuration: require a pull
request and the `check` job from the `Checks` workflow for `main`, block force
pushes and deletion, and review bypass permissions. Enable Dependabot security
updates in GitHub (the committed configuration schedules npm and Actions version
updates). Secure both GitHub and Railway accounts with 2FA. The workflow pins
Actions by commit, disables checkout credential persistence and skips npm install
scripts. Source maps are disabled in builds and Caddy rejects asset map requests.

The web and relay send host-only HSTS (`max-age=31536000`). This protects subsequent
HTTPS visits, not a browser's first HTTP visit. It deliberately omits
`includeSubDomains` and `preload` while the custom relay TLS setup is incomplete.
Review every subdomain and the long-lived HTTPS commitment before changing that
policy; adding a header does not itself enroll a domain in a browser preload list.
See the [HSTS deployment guidance](https://hstspreload.org/).

Before rollout, set the origin/proxy variables, verify the source-IP boundary,
then test two-device pairing and reconnects. Configure edge rate limits and
capacity/uptime alerts separately; application caps are not an alerting system.

## Domains and checks

Add each custom domain to its service, matching the target port above. Copy
Railway's routing and ownership records into Porkbun: root **ALIAS**, `relay`
**CNAME**, and the supplied verification **TXT** records. Preserve unrelated
records. [Porkbun DNS instructions](https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun).

Wait for valid TLS before switching hostnames. Obey certificate retry guidance;
repeatedly removing/re-adding a domain can compound rate limits.

```sh
curl --fail --head https://bambi.cam/
BAMBICAM_ORIGIN=https://bambi.cam npm run smoke:relay -- wss://relay.bambi.cam/relay
```

Use the active relay hostname for the smoke check. Then follow the
[device checklist](M1-ACCEPTANCE.md). Healthchecks do not replace uptime or billing
alerts; container resource limits are not monthly spending caps.
