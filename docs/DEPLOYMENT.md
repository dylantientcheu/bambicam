# Hosted deployment

The hosted pilot uses two Railway services in a single project. Both build from
the repository root because npm workspaces share a lockfile. No database or
volume is required. Railway terminates public HTTPS/WSS.

| Setting | relay | web |
| --- | --- | --- |
| Dockerfile | `relay/Dockerfile` | `docker/web.Dockerfile` |
| Public domain | `relay.bambi.cam` | `bambi.cam` |
| PORT and domain target port | `8787` | `8080` |
| HOST | `0.0.0.0` | Caddy binds on `:8080` |
| Healthcheck | `/health` | `/health` |
| Region / replicas | Europe / 1 | Europe / 1 |
| Sleeping | disabled | disabled |
| Resource limit | 1 vCPU / 0.5 GB | 1 vCPU / 0.5 GB |
| Restart | on failure, at most 5 retries | on failure, at most 5 retries |

Set `NODE_ENV=production` on the relay. Set `SITE_ADDRESS=:8080` and
`RELAY_UPSTREAM=relay.railway.internal:8787` on web. Set web's build variable
`VITE_RELAY_URL=wss://relay.bambi.cam/relay` after that hostname has working DNS
and TLS; until then, use the relay's generated Railway WSS address. The frontend
build embeds that value, so a change requires a new web build.

The hosted frontend talks directly to the relay's public WSS endpoint. This keeps
frontend deployments from restarting its signaling connections. The Caddy
same-origin `/relay` route supports self-hosting and an explicit user override.

Railway injects `PORT`; set it explicitly to match the domain target port. A
healthy deployment alone does not prove the public domain routes to the right
port. Verify the public health and WebSocket endpoints after each deployment.

## Service configuration and release

Service settings are managed in Railway. Legacy `railway.json` configuration is
deprecated by the current platform; these Dockerfiles do not depend on it.
Keep relay deployment overlap at 0 seconds and draining at 5 seconds. A relay
restart intentionally ends existing signaling sessions so peers reconnect to
the same new instance. Do not add replicas without redesigning room routing.

Use watch paths `relay/**`, `package.json`, `package-lock.json`, `.dockerignore`
for relay; use `web/**`, `docker/**`, `package.json`, `package-lock.json`,
`.dockerignore` for web. Changes to shared dependency manifests can rebuild both.

Run checks before publishing. To deploy a local checkout explicitly:

```sh
railway up --project <project-id> --environment production --service relay --detach -m "Describe relay release"
railway up --project <project-id> --environment production --service web --detach -m "Describe web release"
```

`.railwayignore` and `.dockerignore` allow only build inputs. Never upload local
certificates, `.env` files, browser traces, or credentials. The public repository
is the source of truth for later releases. When using GitHub autodeploys, require
the Checks workflow to pass and keep the two service watch paths separate.

## Porkbun DNS

Add each custom domain in its Railway service first. Copy the **exact** routing
target and ownership TXT value Railway supplies; they differ by service.

In Porkbun, open the domain's DNS editor and create:

| Type | Host | Value |
| --- | --- | --- |
| ALIAS | blank | Railway's web routing target |
| CNAME | `relay` | Railway's relay routing target |
| TXT | `_railway-verify` | Web ownership value |
| TXT | `_railway-verify.relay` | Relay ownership value |

Use the default TTL and remove only conflicting parking A/AAAA/ALIAS/CNAME
records. Preserve email and unrelated records. Leave Porkbun nameservers in
place. Root ALIAS is Porkbun's equivalent for Railway's apex CNAME requirement.
See [Porkbun's DNS guide](https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun).

Wait for ownership verification and a valid certificate before using each custom
hostname. If Railway reports a certificate rate limit, obey the retry guidance;
do not repeatedly remove/re-add domains or force issuance. The generated Railway
HTTPS/WSS domains remain a pilot path while custom certificates are pending.
Saved pairings belong to their origin, so install/remember on the final domain
after it works. They do not automatically migrate from a pilot URL.

## Verify and operate

```sh
npm run smoke:relay -- wss://relay.bambi.cam/relay
curl --fail --head https://bambi.cam/
```

Then pair two real phones. Verify moving video, audible sound, Wi-Fi/cellular
behavior where direct connectivity is available, and recovery after a planned
relay restart. A `/health` deployment check is not continuous monitoring. Choose
uptime alerts and billing alerts for the project; resource limits are not a
monthly spending cap. Record measured recovery time and resource use before
calling the hosted overnight acceptance complete.

For rollback, redeploy the previous successful deployment of the affected service
in Railway. A relay rollback interrupts viewing and triggers reconnection. Do
not delete the project, domain, or user data to roll back a release.
