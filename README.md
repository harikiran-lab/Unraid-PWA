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

## GPU Stats Card

The Overview dashboard includes a GPU Stats card. It refreshes with the existing dashboard polling interval and supports multiple NVIDIA GPUs exposed to the container.

The bundled Unraid GraphQL schema exposes GPU inventory only, so live readings use `nvidia-smi` on the host running the PWA. The card shows GPU utilization, VRAM used/total, temperature, power draw/limit, and fan speed. Unsupported readings display **Unavailable**, including devices without a fan sensor. Intel/AMD devices can show API inventory details; live Intel/AMD telemetry is not implemented.

### Enable NVIDIA monitoring on Unraid

1. Install the Unraid **NVIDIA Driver** plugin and verify `nvidia-smi` works in the Unraid terminal.
2. Run this PWA container on that same Unraid host.
3. Set `UNRAID_BFF_GPU_SERVER_URL` in `.env` to the **exact server API base URL saved in the app**, for example `https://192.168.1.10:3443`.
4. Enable GPU access and build this fork:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
   ```

   This builds the fork locally. To use a published image instead, omit `--build`; the default image points to this fork's GHCR package.

For the Unraid Docker template editor instead of Compose, add `--gpus all` to **Extra Parameters**, set `NVIDIA_VISIBLE_DEVICES=all`, `NVIDIA_DRIVER_CAPABILITIES=utility`, and `UNRAID_BFF_GPU_SERVER_URL`, then use an image built from this fork. No privileged mode or Docker socket mount is required.

Local readings are shown **only** for the configured API URL. When switching to another server, its GPU inventory is queried instead, so local GPU readings are never labeled as belonging to a remote server. Different IP addresses and DNS aliases need to match the saved URL. Only NVIDIA GPUs accessible to the container are included in live mode; GPUs assigned exclusively to VMs will generally be unavailable.

If NVIDIA access fails, GPU inventory remains available when the API supports it. GPU errors do not fail the rest of the dashboard. GPU inventory requires API access to `info.gpu`; older APIs or restricted keys may not expose it.

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

