# Unraid PWA

Self-hostable, mobile-first web app to monitor and control Unraid via the GraphQL API.

<p align="center">
  <img src="frontend/public/icon.svg" alt="Unraid PWA icon" width="128" />
</p>

## Screenshots

<p align="center">
  <img src="screenshots/dashboard-mobile.png" alt="Dashboard screenshot" width="220" />
  <img src="screenshots/storage-mobile.png" alt="Storage screenshot" width="220" />
</p>
<p align="center">
  <img src="screenshots/shares-mobile.png" alt="Shares screenshot" width="220" />
  <img src="screenshots/docker-mobile.png" alt="Docker screenshot" width="220" />
</p>
<p align="center">
  <img src="screenshots/vm-mobile.png" alt="VM screenshot" width="220" />
</p>

## Install On Unraid (Terminal)

> This app is **not yet in Community Applications**. Install it manually with Docker Compose.

### Using Pre-built Image (Recommended)

Pre-built Docker images are automatically published to GitHub Container Registry.

Run these commands on your Unraid server terminal:

```bash
cd /mnt/user/appdata
git clone https://github.com/harikiran-lab/Unraid-PWA.git
cd Unraid-PWA

# Optional: customize environment values
cp .env.example .env
nano .env

# Start using pre-built image
docker compose up -d

# Check status
docker compose ps
```

### Building From Source

If you prefer to build the image locally:

```bash
cd /mnt/user/appdata
git clone https://github.com/harikiran-lab/Unraid-PWA.git
cd Unraid-PWA

# Optional: customize environment values
cp .env.example .env
nano .env

# Build and start
docker compose up -d --build

# Check status
docker compose ps
```

Open:

- `http://<UNRAID-IP>:2442`

First run in the UI:

1. Add your Unraid server URL (`https://<unraid-ip>:3443`)
2. Add your Unraid API key
3. Save setup

## Update On Unraid

```bash
cd /mnt/user/appdata/Unraid-PWA
git pull
docker compose up -d --build
```

## Stop / Start

```bash
cd /mnt/user/appdata/Unraid-PWA
docker compose down
docker compose up -d
```

## Data Persistence

Persistent app data is stored in:

- `backend/data/servers.enc` (encrypted server credentials)
- `backend/data/encryption.key` (local encryption key)
- `backend/data/audit.log` (write action audit log)

Back up the `backend/data` folder.

## Configuration

`.env` is optional. Defaults work out of the box.

Available variables (see `.env.example`):

- `UNRAID_BFF_PORT` (default `3001`, mapped to host port `2442` in `docker-compose.yml`)
- `UNRAID_BFF_ORIGIN` (CORS allowlist for cross-origin `/api` requests; same-origin usage on `http://<UNRAID-IP>:2442` does not need this)
- `UNRAID_BFF_ENCRYPTION_KEY` (optional override; if empty, app auto-generates and persists `backend/data/encryption.key`)
- `UNRAID_BFF_ALLOW_SELF_SIGNED` (`true`/`false`)
- `UNRAID_BFF_TRUST_PROXY` (`false`, `true`, or proxy mode)
- `UNRAID_BFF_GPU_SERVER_URL` (optional; exact Unraid API server URL saved in the PWA; enables local NVIDIA stats for that server)

## GPU Stats Card

The Overview dashboard includes a GPU Stats card. It refreshes with the existing dashboard polling interval and supports multiple NVIDIA GPUs exposed to the container.

The bundled Unraid GraphQL schema exposes GPU inventory only, so live readings use `nvidia-smi` on the host running the PWA. The card shows GPU utilization, VRAM used/total, temperature, power draw/limit, fan speed, encoder/decoder utilization, and a collapsible Active Apps list. Unsupported readings display **Unavailable**, including devices without a fan sensor. Intel/AMD devices can show API inventory details; live Intel/AMD telemetry is not implemented.

### Enable NVIDIA monitoring on Unraid

1. Install the Unraid **NVIDIA Driver** plugin and verify `nvidia-smi` works in the Unraid terminal.
2. Run this PWA container on that same Unraid host.
3. Set `UNRAID_BFF_GPU_SERVER_URL` in `.env` to the **exact server API base URL saved in the app**, for example `https://192.168.1.10:3443`.
4. Enable GPU access and build from source:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
   ```

   This builds the image from source. To use your fork's published GHCR image instead, omit `--build`.

### Unraid Docker template settings

The [Unraid template](templates/unraid-pwa.xml) uses `ghcr.io/harikiran-lab/unraid-pwa:latest` and includes the NVIDIA settings below. NVIDIA GPU access is enabled by default in this template and requires the Unraid NVIDIA Driver plugin. On a host without NVIDIA support, remove `--gpus all` from **Extra Parameters** before applying the template.

In **Docker → Unraid-PWA → Edit**, enable **Advanced View** to see Extra Parameters:

| Setting | Value |
| --- | --- |
| Repository | `ghcr.io/harikiran-lab/unraid-pwa:latest` |
| Extra Parameters | `--gpus all` (append it to any existing parameters) |
| `NVIDIA_VISIBLE_DEVICES` | `all` (or the UUID of the NVIDIA GPU to monitor) |
| `NVIDIA_DRIVER_CAPABILITIES` | `utility` |
| `UNRAID_BFF_GPU_SERVER_URL` | Exact Unraid API server URL saved in the PWA, including scheme and port |

**GPU Server URL is the Unraid connection address, not the PWA dashboard address.** Open the PWA's server settings and copy the URL used to connect to that Unraid host. For example, if the saved connection is `https://192.168.1.10:3443`, enter that exact URL. The PWA's default dashboard URL `http://192.168.1.10:2442` is not the API URL. Port `3443` is only an example; use the actual port and scheme saved in the app.

The GPU Server URL field is intentionally blank by default. Leaving it blank disables local NVIDIA collection. Click **Apply** after changing Docker variables, then refresh the dashboard. No privileged mode or Docker socket mount is required.

Updating the image does not add new variables to an existing Unraid container template. Existing installations must add the settings above manually or update their saved template while preserving their App Data mapping.

Verify the URL and GPU access from the Unraid terminal (replace `YOUR_CONTAINER_NAME` with the container name shown in Docker):

```sh
docker exec YOUR_CONTAINER_NAME printenv UNRAID_BFF_GPU_SERVER_URL
docker exec YOUR_CONTAINER_NAME nvidia-smi
```

The first command should print the same API URL saved in the PWA; the second should list the GPU. If the URL is missing or does not match, the app skips local NVIDIA collection.

Local readings are shown **only** for the configured API URL. When switching to another server, its GPU inventory is queried instead, so local GPU readings are never labeled as belonging to a remote server. Different IP addresses and DNS aliases need to match the saved URL. Only NVIDIA GPUs accessible to the container are included in live mode; GPUs assigned exclusively to VMs will generally be unavailable.

If NVIDIA access fails, GPU inventory remains available when the API supports it. GPU errors do not fail the rest of the dashboard. GPU inventory requires API access to `info.gpu`; older APIs or restricted keys may not expose it.

## GPU video engines and active apps

Encoder and decoder bars show NVIDIA driver samples. Active Apps lists driver-reported compute and graphics processes with PID, short process name, GPU/encoder/decoder percentages, and VRAM usage where supported. Unsupported metrics remain **Unavailable**. The driver can report fewer apps in restricted environments; this list is not a complete inventory of installed applications.

For host process names, map `/proc` to `/host/proc` as **read-only**. The app reads only `/host/proc/<PID>/comm`; it does not read process command lines or environments. Without this mapping, the driver may only supply a PID. No Docker socket or host PID namespace is needed. The updated Unraid template and GPU Compose override include this mapping.

## CPU and motherboard temperatures

The Usage card includes CPU temperature; the System card includes motherboard temperature. Local readings come directly from Linux hwmon sensors through a **read-only** `/sys` → `/host/sys` mapping, included in the updated Compose file and Unraid template. Unraid must have the appropriate hardware-monitoring drivers loaded. CPU package readings are also queried through the CPU-only Unraid API as a fallback when supported. The combined API temperature endpoint is not polled, so this feature does not request disk temperature scans.

| Setting | Purpose |
| --- | --- |
| `/sys:/host/sys:ro` | Read-only host CPU/motherboard sensors |
| `/proc:/host/proc:ro` | Optional host GPU process names |
| `UNRAID_BFF_LOCAL_SERVER_URL` | Exact saved API URL of the container host; defaults to `UNRAID_BFF_GPU_SERVER_URL` when empty |
| `UNRAID_BFF_CPU_SENSOR` | Optional exact `chip:tempN` CPU sensor selector |
| `UNRAID_BFF_MOTHERBOARD_SENSOR` | Optional exact `chip:tempN` motherboard sensor selector |

Automatic CPU detection prefers package/Tctl/Tdie sensors. Automatic motherboard detection uses explicit System/Motherboard/MB/SYSTIN labels. An unlabeled channel such as `temp1` is not guessed to be the motherboard; identify it with your hardware documentation or Unraid sensor setup, then set a selector such as `nct6798:temp1`. The chip name is the content of the hwmon `name` file, and `tempN` identifies its `tempN_input` file. Incorrect or missing selections display **Unavailable** rather than another device's temperature.

Local readings are only attached to the matching saved server URL. A remote server can still supply CPU package temperature through its API; local motherboard readings are never attached to it.

**Existing Unraid containers:** add the two read-only path mappings and any desired selector variables in Docker → Edit, then Apply. Updating the image alone does not update saved container mappings. Privileged mode is not needed.

## Docker container updates

Container cards show **Update available**, **Up to date**, or **Update status unavailable**, based on Unraid's `isUpdateAvailable` field. These reflect Unraid's current update-check results; the PWA does not contact registries on every poll. Use Unraid's update check to refresh cached registry status when necessary.

When the API exposes `docker.updateContainer` and the key has Docker write access, an **Update** button opens a confirmation describing the container recreation and possible service interruption. The app submits one update request to the server selected at confirmation, waits up to about ten minutes, and refreshes the dashboard on success. Duplicate clicks are blocked. A disconnect or timeout is reported as an uncertain outcome: check Unraid before trying again. Updating this PWA container itself can disconnect the browser; reconnect once it restarts.

Older APIs or API keys that cannot read update status show **Update status unavailable**. If the native update mutation cannot be detected (including denied schema introspection), the Update button is disabled. Updates use the normal Unraid API, CSRF protection, rate limiting, and action audit logging; no Docker socket is mounted.

## Local Development

```bash
npm --prefix backend install
npm --prefix frontend install
npm run dev:backend
npm run dev:frontend
```

Frontend dev URL:

- `http://localhost:5173`

## Quality Checks

```bash
npm run lint
npm run test
npm run test:e2e
```

## License

MIT (`LICENSE`).

