# RatAvert — Production Build

This is the real, backend-connected version of the RatAvert dashboard described
in the build brief. All demo data generators (`genLogs`, `genChart`,
`genPhotoSVG`, the random `doRatSeq` simulator, and the in-memory
`DEFAULT_ACCOUNTS`) have been deleted. Every number, log entry, chart, and
photo the dashboard shows now comes from the backend, which in turn only
knows what your Raspberry Pi reports.

```
Raspberry Pi (camera + YOLOv8 + GPIO)
        │  reports detections & status  (pi/ratavert_client_example.py)
        ▼
backend/  — Node/Express + SQLite + WebSocket
        │  serves REST/WebSocket API
        ▼
frontend/ — React + Vite dashboard
```

## What's in this folder

- **`backend/`** — the REST + WebSocket API and SQLite database. This is the
  single source of truth: accounts, settings, detections, trigger history,
  and photos all live here permanently.
- **`frontend/`** — the dashboard (Vite + React). No fabricated data anywhere;
  everything is fetched from, or streamed by, the backend.
- **`pi/ratavert_client_example.py`** — a reference client showing exactly how
  your Pi should call the backend, matching the data contract below. Wire in
  your real camera/YOLOv8/GPIO code where marked.

## 1. Run the backend

```bash
cd backend
cp .env.example .env
# edit .env: set JWT_SECRET, DEVICE_KEY (random strings), and a real
# SEED_ADMIN_PASSWORD — generate secrets with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npm start
```

On first run it creates the `ratavert.db` SQLite file and seeds one admin
account from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`. **Log in once and
create your real accounts, then consider changing the seed password.**

## 2. Run the frontend

```bash
cd frontend
cp .env.example .env
# edit .env: point VITE_API_URL / VITE_WS_URL at your backend
npm install
npm run dev      # local dev server
# or: npm run build && serve the dist/ folder from any static host
```

Sign in with the seed admin account, then go to **Admin Panel → User
Management** to create real accounts for everyone else.

## Connect your Raspberry Pi (the easy way)

Once your backend is deployed (see "Deploying for real" below) or running
locally, this is the fastest path to a Pi that's permanently connected —
survives reboots, restarts itself if it crashes, no manual re-running of
scripts.

1. Get two things ready:
   - Your backend's public URL (e.g. `https://ratavert-backend-production.up.railway.app`,
     or `http://<your-PC-IP>:4000` for local-network setups)
   - Your `DEVICE_KEY` (from the backend's `.env` / Railway environment variables)
2. Copy the whole `pi/` folder onto the Raspberry Pi (e.g. `scp -r pi pi@<pi-ip>:~/ratavert-pi-setup`,
   or `git clone` the repo directly on the Pi).
3. SSH into the Pi and run the installer:
   ```bash
   cd ratavert-pi-setup   # or wherever you copied pi/ to
   bash install.sh --device-key YOUR_DEVICE_KEY --backend https://your-backend-url
   ```
   (Or just run `bash install.sh` with no arguments and it'll ask you for both.)
4. That's it. The installer:
   - Installs the one Python dependency it needs (`requests`)
   - Copies the client to `~/ratavert-pi/`
   - Registers it as a **systemd service** that starts on every boot and
     auto-restarts if it ever crashes
   - Starts it immediately

Check it's running:
```bash
sudo systemctl status ratavert
```
Watch live logs:
```bash
journalctl -u ratavert -f
```

Within a few seconds, your dashboard's sidebar should flip to **🍓 RASPBERRY PI → ONLINE**.

**To wire in your real detection code** later, edit `~/ratavert-pi/ratavert_client_example.py`
on the Pi (fill in `fire_trigger()`, `capture_photo_path()`, `run_yolo_detection()`),
then run `sudo systemctl restart ratavert` to pick up the changes — no need
to re-run the installer.

*(Prefer to run it manually in the foreground instead of as a service —
e.g. while actively debugging? See the reference walkthrough below.)*

## Connect your Raspberry Pi (manual / reference walkthrough)

1. Copy `pi/ratavert_client_example.py` to the Pi.
2. `pip3 install requests`
3. Fill in the three stub functions at the top of the file with your real
   code: `fire_trigger()` (GPIO), `capture_photo_path()` (camera), and
   `run_yolo_detection()` (YOLOv8 inference).
4. Run it with your backend URL and the device key from `backend/.env`:
   ```bash
   DEVICE_KEY=<paste from backend/.env>  BACKEND_URL=http://<backend-host>:4000 \
     python3 ratavert_client_example.py
   ```
5. In the dashboard, sign in as an admin → **Settings → Device** → enter the
   Pi's IP → **Connect**. Once the Pi's heartbeat arrives, the sidebar and
   status bar flip to "ONLINE" automatically.

The dashboard never talks to the Pi directly — it only talks to the backend,
which avoids the HTTPS/mixed-content problem called out in the brief, and
means history survives refreshes and works from multiple devices.

## Data contract (implemented exactly as specified)

| Pi → Backend | Purpose |
|---|---|
| `POST /api/pi/heartbeat` | `{online, ip, armed, last_seen}` — device status |
| `POST /api/pi/photos` | multipart upload, returns `{photo_id, photo_url}` |
| `POST /api/pi/detections` | `{timestamp, confidence, photo_url, actions_fired, escalated_to_last_resort}` |
| `POST /api/pi/ack` | `{type, status, fired_at}` — trigger fire acknowledgment |
| `GET /api/pi/commands` | Pi polls every ~2s for manual test-fires queued by the dashboard |

All five are protected by the shared `DEVICE_KEY` (sent as the `x-device-key`
header), separate from user login tokens.

| Dashboard ↔ Backend | Purpose |
|---|---|
| `POST /api/auth/login` | returns a JWT |
| `GET/POST /api/settings` | detection interval, detecting on/off, armed toggles |
| `GET /api/status` | Pi online/offline, armed state, owner |
| `POST /api/trigger` | fire a trigger `{type, duration}` (rate-limited, 10s cooldown per user/type) |
| `GET /api/logs` | merged, paginated activity log for the dashboard tables |
| `GET /api/detections` | raw detection rows, used for the photo gallery |
| `GET /api/analytics/hourly` | 24h trigger-frequency chart data |
| `GET /api/photos/:id` | serves the actual captured JPEG |
| `GET/POST/PATCH /api/accounts` | real accounts, bcrypt-hashed passwords, admin-only |
| `POST /api/device/connect` / `disconnect` | admin-only device pairing |
| `WS /ws/events` | pushes `detection`, `trigger_ack`, `trigger_requested`, `status`, `settings`, `accounts_changed` — the dashboard updates instantly instead of polling |

## New: self-service password change + real webcam test capture

- **Settings → Account** — any logged-in user can change their own password
  (`POST /api/auth/change-password`, requires the current password, bcrypt-hashed
  like everything else). This is separate from the admin-only account
  management in Admin Panel → User Management.
- **Triggers → Webcam Test Capture** — a real, working test of the full photo
  pipeline that doesn't need the Pi at all. It asks for your browser's camera
  permission, grabs an actual frame, uploads it to `POST /api/captures/photo`,
  and the result shows up instantly (via the WebSocket) in the Activity log
  and Photos gallery, tagged "📸 Test Capture" by whoever captured it. These
  are stored in the same `detections` table as real Pi detections but tagged
  `source='manual'`, so they never inflate rat-detection counts or analytics.

## Design decisions worth knowing about

- **Command delivery is Pi-polls-backend, not backend-pushes-to-Pi.** This
  means the Pi never needs to run its own server or open a port, so it works
  fine behind a home router/NAT with no port forwarding. The tradeoff is up
  to ~2s of added latency on manual test-fires, which is a fine tradeoff for
  a home deployment. If you want it near-instant, swap the polling loop in
  `pi/ratavert_client_example.py` for a WebSocket client subscribed to
  `/ws/events` (the backend already broadcasts `trigger_requested`).
- **Device pairing is admin-only.** The prototype let any logged-in user
  claim the Pi; the backend now requires admin for `/api/device/connect` and
  the install command, since re-pointing physical hardware at a different
  network shouldn't be a standard-user action. Everyone can still view
  status, arm/disarm, and test-fire triggers (rate-limited).
- **Passwords are bcrypt-hashed**, sessions are JWTs (12h expiry), and the
  device key is a separate secret from user credentials — none of the
  "auth hardening" items from the brief are left undone.
- **Photos are served from local disk**, not stored as base64 in SQLite, to
  keep the database fast as noted in the brief. Swap `backend/photos/` for
  an S3-compatible bucket later without touching the API shape.
- **Single-device model.** The schema note about adding a `device_id` for
  multi-Pi setups was intentionally *not* built out, since you're running one
  Pi. If you add a second one later, the `device` row becomes a table keyed
  by `device_id`, and `/api/status`, `/api/pi/*`, and the sidebar all take a
  device selector — everything else (accounts, trigger history shape,
  WebSocket events) stays the same.
- **Not built (optional per the brief):** a live MJPEG/WebRTC camera feed.
  Only snapshot-on-detection photos are implemented, matching the "suggested,
  not required" framing in the brief.

## Phased plan status

1. ✅ **Backend + DB** — REST API, SQLite, real accounts/settings.
2. ✅ **Pi integration** — data contract implemented on both ends; the
   dashboard reads real data everywhere the demo generators used to be.
3. ✅ **Real-time** — `/ws/events` pushes detections and trigger acks
   instantly; a 30s poll remains only as a fallback if the socket drops.
4. ✅ **Cleanup** — `genLogs`, `genChart`, `genPhotoSVG`, `doRatSeq`, and
   `DEFAULT_ACCOUNTS` no longer exist anywhere in `frontend/src/App.jsx`.

## Deploying for real (public, accessible web app)

This is the recommended split: **frontend on Vercel, backend on Railway**. Both
have generous free tiers, deploy from a GitHub repo automatically, and give
you HTTPS URLs — no port forwarding, no keeping your PC on 24/7, and no
localhost/firewall wrangling for the Pi to deal with.

### Step 1 — Push this project to GitHub
Create a new GitHub repo and push the whole `ratavert/` folder to it (both
`backend/` and `frontend/` in the same repo is fine — you'll point each
platform at its own subfolder).

### Step 2 — Deploy the backend to Railway
1. Go to https://railway.app, sign in with GitHub, **New Project → Deploy from GitHub repo**.
2. Select your repo. When asked for the root directory, set it to `backend`.
3. Railway auto-detects Node and runs `npm install` + `npm start`. It also
   picks up `backend/railway.json` automatically.
4. Add a **persistent volume**: Settings → Volumes → Add Volume, mount path `/data`.
5. Go to **Variables** and add everything from `backend/.env.example`, with
   real values:
   - `DATA_DIR=/data` (matches the volume mount path)
   - `JWT_SECRET` / `DEVICE_KEY` — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — your real admin login
   - `CORS_ORIGIN` — leave as `http://localhost:5173` for now, you'll update it in Step 4
6. Deploy. Railway gives you a public URL like `https://ratavert-backend-production.up.railway.app`.
7. Confirm it's alive: visit `https://your-backend-url/api/health` in a
   browser — you should see `{"ok":true,...}`.

*(Prefer Render instead? `backend/render.yaml` does the equivalent setup —
New → Blueprint → point at your repo.)*

### Step 3 — Deploy the frontend to Vercel
1. Go to https://vercel.com, sign in with GitHub, **Add New → Project**.
2. Select your repo, set the root directory to `frontend`.
3. Vercel auto-detects Vite (and reads `frontend/vercel.json`).
4. Under **Environment Variables**, add:
   - `VITE_API_URL` = your Railway backend URL from Step 2 (e.g. `https://ratavert-backend-production.up.railway.app`)
   - `VITE_WS_URL` = the same URL but with `wss://` instead of `https://`
5. Deploy. Vercel gives you a public URL like `https://ratavert.vercel.app`.

### Step 4 — Connect the two
Go back to Railway → your backend's Variables → update `CORS_ORIGIN` to your
real Vercel URL (e.g. `https://ratavert.vercel.app`), redeploy.

### Step 5 — Open your live site
Visit your Vercel URL from any device, anywhere — sign in with the admin
account you set in Step 2.

### Step 6 — Point the Pi at the public backend instead of your PC
This is the part that gets *simpler* now: instead of finding your PC's LAN
IP and configuring Windows Firewall, the Pi just talks to your public
Railway URL directly — it works from any network with internet access, not
just your home Wi-Fi:
```bash
DEVICE_KEY=paste_your_device_key_here \
BACKEND_URL=https://ratavert-backend-production.up.railway.app \
python3 ratavert_client_example.py
```
No firewall rules, no port forwarding, no matching Wi-Fi networks required.

### Ongoing
Every `git push` to your repo auto-redeploys both platforms. Your database
and photos persist across redeploys because they live on the Railway volume,
not inside the container.
