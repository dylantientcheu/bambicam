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

Relay variables: `HOST=0.0.0.0`, `NODE_ENV=production`.
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

## Domains and checks

Add each custom domain to its service, matching the target port above. Copy
Railway's routing and ownership records into Porkbun: root **ALIAS**, `relay`
**CNAME**, and the supplied verification **TXT** records. Preserve unrelated
records. [Porkbun DNS instructions](https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun).

Wait for valid TLS before switching hostnames. Obey certificate retry guidance;
repeatedly removing/re-adding a domain can compound rate limits.

```sh
curl --fail --head https://bambi.cam/
npm run smoke:relay -- wss://relay.bambi.cam/relay
```

Use the active relay hostname for the smoke check. Then follow the
[device checklist](M1-ACCEPTANCE.md). Healthchecks do not replace uptime or billing
alerts; container resource limits are not monthly spending caps.
