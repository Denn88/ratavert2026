---
name: pi-client
description: Use when editing the Raspberry Pi side of RatAvert (Python client, install script, systemd service) in the pi/ folder.
---

# RatAvert Raspberry Pi Client

## Context
The Pi is a Raspberry Pi 3 B+ (not Pi 4). It detects rats and reports events to the backend API. It runs as a systemd service.

## Before changing anything
1. Read `pi/ratavert_client_example.py`, `pi/install.sh`, and `pi/ratavert.service`.
2. Check `backend/server.js` for the endpoints and payload format the Pi must send. The client must match the backend.

## Rules
1. Always write "Raspberry Pi 3 B+" in code comments and documentation.
2. Keep the code lightweight. The Pi 3 B+ has limited CPU and 1 GB RAM.
3. Keep the backend URL and credentials in configuration or environment variables. Never hard-code them.
4. Handle network failures. The client must retry and must not crash when the backend is unreachable.
5. `install.sh` must be safe to re-run. Do not delete user data.
6. If `ratavert.service` changes, explain the commands to apply it (`sudo systemctl daemon-reload`, `sudo systemctl restart ratavert`).
7. Do not commit secrets, API keys, or device credentials.

## Output
- Summarize changes in bullets.
- List any commands the user must run on the Pi.