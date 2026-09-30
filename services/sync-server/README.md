# AirQR Sync Server (Python)

Simple backend used to receive scanned packets and store reconstructed files.
The core server stays Python, but packet-based scan reconstruction now uses a
packaged Node.js + WASM runtime under `sync_server/runtime/packet_assembler/`.

## Quick Start

```bash
# Install dependencies (optional, only needed for WebSocket support)
pip install -r requirements.txt

# Install Node.js 18+ if you want the server to reconstruct files from stored
# packets when /api/scan/complete arrives without the final binary payload.

# Create a user before starting the default public (0.0.0.0) bind
python server.py --create-user admin --password "your_password"

# Start the server (SQLite storage, HTTP + WS on 8081 by default)
python server.py

# Optional split-port dev override
python server.py --port 8081 --ws-port 8082

# Start with a custom config
python server.py --config config.json --port 9000
```

The default bind is non-loopback, so startup fails closed until the users file
contains a valid user/API key. If you prefer declarative first-start auth instead
of a separate `--create-user` step, set:

```bash
AIRQR_BOOTSTRAP_USERNAME=admin
AIRQR_BOOTSTRAP_PASSWORD=change-me
```

When both variables are set, the server creates that user on startup if it does not already exist. Existing users are left unchanged. Use a real, unique password; `change-me` is only a placeholder.

## Operational Logging

The sync-server now emits two structured startup lines that are useful in real deployments:

- `server.retention ...`
- `server.start ...`

Examples:

```text
server.retention deleted_history_items=3 deleted_incomplete_sessions=2 retention_history_days=30 retention_incomplete_days=7
server.start allowed_origins=none auth_mode=users-file bind=0.0.0.0:8081 export_dir=null lan_urls=https://airqr.example.com local_url=https://localhost:8081 scheme=https static_dir=/srv/airqr/web storage_backend=sqlite storage_dir=/data/airqr trusted_proxies=1 configured verbose=false ws_mode=shared
```

These lines are intended to answer quickly:

- what the server really bound to
- whether WebSocket is shared, split, or disabled
- which storage/auth mode is active
- whether retention actually ran
- which local/LAN URL is expected to work

Runtime scan paths now also emit structured `key=value` logs on the main completion / assembly paths, for example:

- `scan.packet.threshold_pending ...`
- `scan.packet.auto_completed ...`
- `scan.complete.assembly_failed ...`
- `scan.complete.finalized ...`
- `ws.scan.complete_failed ...`
- `ws.scan.complete_succeeded ...`
- `ws.scan.auto_complete_threshold_pending ...`
- `ws.scan.auto_completed ...`

These are intended to answer quickly:

- did the session reach decode threshold
- did assembly fail because packets are still missing or undecodable
- did a WS session complete normally or via auto-complete
- which session/file/size was actually finalized

## Configuration

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--host` | 0.0.0.0 | Bind address |
| `--port` | 8081 | HTTP port |
| `--ws-port` | same as `--port` | WebSocket port (`0` to disable; set a different port only for split internal dev setups) |
| `--storage-dir` | ./storage | Data directory |
| `--config` | - | Config file path (JSON/YAML) |
| `--allow-origin` | - | Allowed CORS origin (repeatable). Use exact origins for credentialed browser access; `*` is non-credentialed only |
| `--allow-unauthenticated` | false | Unsafe explicit opt-out that permits an unauthenticated non-loopback bind |
| `--tls-cert` | - | TLS certificate path |
| `--tls-key` | - | TLS private key path |
| `--trusted-proxy` | - | Trusted proxy IP/CIDR whose `Forwarded` / `X-Forwarded-*` headers are honored |
| `--retention-incomplete` | 7 | Days to keep incomplete sessions |
| `--retention-history` | 30 | Days to keep history |
| `--no-sqlite` | false | DEPRECATED: legacy JSON mode |

### Configuration File (`config.json`)

```json
{
  "host": "127.0.0.1",
  "port": 8081,
  "ws_port": 8081,
  "storage_dir": "/data/airqr",
  "allowed_origins": [],
  "trusted_proxies": ["127.0.0.1/32"],
  "retention_incomplete_days": 7,
  "retention_history_days": 30
}
```

CLI arguments take priority over the config file.

### Bootstrap auth via environment

The sync-server can bootstrap one initial local account from environment variables:

- `AIRQR_BOOTSTRAP_USERNAME`
- `AIRQR_BOOTSTRAP_PASSWORD`

Behavior:

- if both are unset: no bootstrap happens
- if only one is set: startup fails
- if both are set and no valid user or API key exists: the bootstrap user is
  created before the server starts
- if any valid authentication principal exists: nothing is changed

### Public-bind authentication migration

A non-loopback bind such as the default `0.0.0.0` now refuses to start unless at
least one of these conditions is true:

- the users file already contains a valid user or API key
- both bootstrap environment variables above contain non-empty values
- the operator deliberately passes the unsafe `--allow-unauthenticated` opt-out

The last option exposes the sync API without authentication. It is intended only
for an explicitly isolated environment and is never enabled by the supplied
Docker or deployment examples. First-user setup is never accepted over HTTP,
including on loopback binds, because a local peer cannot be distinguished
reliably from a reverse proxy or SSH tunnel. Bootstrap with the environment
variables above or `--create-user`; the credentials endpoint is available only
after authentication for credential rotation.

This is intended for local `.env`, Docker Compose, and Docker stack environments.

## Storage

By default, storage uses SQLite (`./storage/airqr.db`).

To store data on a server:

```bash
python server.py --storage-dir "Z:\airqr-storage"
```

## Packet Assembly Runtime

When the final file body is missing, the sync-server can reconstruct the file from
the already stored QR packets. That fallback now uses the packaged runtime in:

- `sync_server/runtime/packet_assembler/assemble_scan_packets.mjs`
- `sync_server/runtime/packet_assembler/airqr_core.js`
- `sync_server/runtime/packet_assembler/airqr_core_bg.wasm`

Operational expectations:

- bare-Python server deployment: install `node` on the server and deploy the full `services/sync-server/` directory
- Docker server deployment: the image installs `nodejs`, embeds this runtime, and also bundles the built web frontend
- if `node` is missing, direct binary uploads still work; only packet-based reconstruction fallback is unavailable

## Health Checks

- `GET /health` - basic health check, returns `200` if the server is running
- `GET /ready` - readiness check, verifies storage availability

Example `/ready` response:

```json
{
  "status": "ready",
  "checks": {
    "storage": "ok",
    "database": "ok"
  }
}
```

## HTTPS (recommended for iOS)

If your web app runs over HTTPS, the backend should run over HTTPS too.

```bash
# Generate a cert whose SAN includes the LAN IP you open from the phone/browser
mkcert -install
mkcert -cert-file cert.pem -key-file key.pem airqr.example.com localhost 127.0.0.1 ::1

python server.py --tls-cert cert.pem --tls-key key.pem
```

Important points:

- `cert.pem` and `key.pem` are not committed to the repo. You must generate them locally first.
- The hostname you use must be included in the certificate SAN.
- On iPhone/iPad, you must install and trust the local `mkcert` root CA before Safari will accept the certificate.
- If a phone shows the page after a browser warning but API calls still fail, that is expected: the local `mkcert` root CA must be fully installed and trusted for that exact local IP/hostname, not just bypassed once in the browser UI.
- The server only trusts `Forwarded` / `X-Forwarded-*` when the TCP peer IP matches `--trusted-proxy` / `trusted_proxies`. Validated `Forwarded: for=` or `X-Forwarded-For` chains provide per-client authentication rate-limit identities; spoofed headers from untrusted peers are ignored. Without that explicit trust list, cookie security and client identity stay based on the TCP peer.

## API Endpoints

### Scan Sessions

- `POST /api/scan/packet` - store one packet
- `POST /api/scan/complete` - finalize a session
  - accepts JSON metadata-only when the server can reconstruct from stored packets
  - accepts raw binary request bodies with query-string metadata (web nominal path)
- `GET /api/scan/history` - list sessions
- `GET /api/scan/session/<id>` - session metadata
- `GET /api/scan/session/<id>/file` - download the reconstructed file
- `GET /api/scan/session/<id>/packets` - download packet metadata
- `DELETE /api/scan/session/<id>` - delete a session

### History Items

- `POST /api/history/item` - store a generated file
  - accepts raw binary request bodies with query-string metadata (web nominal path)
- `GET /api/history` - list history items
- `GET /api/history/item/<id>/file` - download a file
- `DELETE /api/history/item/<id>` - delete an item

### WebSocket

- `ws://host:port/api/ws/events` - real-time event channel
- `ws://host:port/api/ws/scan/<sessionId>` - binary scan channel

For browser production, prefer one public HTTPS origin in front of the sync-server.
If your deployment keeps separate internal API and WS listeners, hide that split behind
your reverse proxy or tunnel rather than exposing it to the client.
If you don't need that split, `--ws-port == --port` now serves both channels on the same listener.

## Auth

The client sends either:

- `Authorization: Basic base64(username:password)`
- `X-API-Key: <key>` if one was added to `users.json`

The `users.json` file is created by `--create-user`.

Browser same-origin flow:

- `POST /api/auth/login` accepts JSON `{ "username": "...", "password": "...", "remember": true }`
- the server always sets the normal HttpOnly session cookie and, by default, also sets a longer-lived HttpOnly `airqr_remember` cookie
- `remember: false` can opt out of that long-lived remember cookie
- `GET /api/auth/status` authorizes via either the current session cookie or the remember cookie
- `POST /api/auth/logout` clears both cookies for the current browser

Logout invalidates all existing browser session and remember tokens for that
user, including tokens held by other browsers. Replacing the account credentials
through `POST /api/auth/credentials` does the same; API keys and Basic auth are
not browser tokens and follow their own credential lifecycle.

This means a returning browser stays signed in by default, but a completely fresh browser still needs one explicit sign-in.

Cookie-auth write protection:

- cookie-authenticated `POST` / `DELETE` routes now require `X-AirQR-CSRF: 1`
- if the browser also sends `Origin`, it must match the current server origin
- the bundled web app already sends this header on its server mutations
- Basic auth and `X-API-Key` requests are not blocked by this CSRF guard

## External Direct Browser Sync

AirQR supports two browser sync modes:

- Same-origin mode: the web app and sync-server share one public origin, so browser cookies can be used.
- External direct mode: the web app calls an explicit sync-server URL from Settings. The visible Settings form uses username/password and sends `Authorization: Basic ...` with browser credentials omitted. API keys are supported for API clients or preconfigured client config, but are not exposed as a Settings field.

For external direct mode, enable sync-server auth. When auth is enabled, `/api/*` replies can echo the requesting browser origin for non-credentialed CORS so Basic/API-key requests work without adding every frontend origin to `--allow-origin`.

Use HTTPS for externally reachable servers. HTTP LAN sync-server URLs are only for AirQR pages loaded over HTTP on the same LAN. From an HTTPS AirQR page, use an HTTPS sync-server URL or configure `same-origin` behind the HTTPS reverse proxy; do not paste a private HTTP backend URL into Settings.

Keep `--allow-origin` for origins that must use cookie-backed browser sessions. Auto external API CORS never sends `Access-Control-Allow-Credentials: true`.

## Docker

```dockerfile
docker build -f services/sync-server/Dockerfile -t airqr-sync-server .
```

```bash
docker run -p 8081:8081 -v /data/airqr:/data \
  -e AIRQR_BOOTSTRAP_USERNAME=admin \
  -e AIRQR_BOOTSTRAP_PASSWORD='replace-with-a-long-random-password' \
  airqr-sync-server python server.py --port 8081 --ws-port 8081 --storage-dir /data
```

## Same-Origin / CORS Notes

- On iPhone, install and trust the mkcert CA (`rootCA.pem`).
- If the app runs over HTTPS, the server should run over HTTPS too.
- Recommended production model: one HTTPS origin for app + API + WS behind a reverse proxy.
- In that model, do not set `--allow-origin` at all; the browser never crosses origins.
- Only add `--allow-origin ...` for intentional cross-origin dev or migration setups.
- `--allow-origin '*'` now returns `Access-Control-Allow-Origin: *` without `Access-Control-Allow-Credentials`, so browser cookies are not shared cross-origin in wildcard mode.
- If you really need cross-origin browser credentials, list the exact trusted origins instead of using `*`.


- [docs/deployment/README.md](../../docs/deployment/README.md)

## Deployment Verification Checklist

After booting the sync-server in a real environment:

1. Confirm one `server.retention ...` line appears at startup.
2. Confirm one `server.start ...` line matches the intended topology:
   - bind host/port
   - `ws_mode`
   - `scheme`
   - `storage_dir`
   - `allowed_origins`
   - `trusted_proxies`
3. Open the app from the exact public/local URL you expect end users to use.
4. Run one real scan/upload and confirm at least one runtime scan log appears:
   - success path: `scan.complete.finalized ...` or `ws.scan.complete_succeeded ...`
   - threshold-but-not-yet-decodable path: `scan.packet.threshold_pending ...` or `ws.scan.auto_complete_threshold_pending ...`
5. If browser auth is cookie-based and behind a proxy/tunnel, confirm login/logout and one write route (`POST` or `DELETE`) still work end-to-end.
