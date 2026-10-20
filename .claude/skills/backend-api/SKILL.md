---
name: backend-api
description: Use when editing or extending the RatAvert backend (REST and WebSocket API, SQLite database, JWT auth, photo uploads). Covers backend/server.js, backend/db.js, and deployment configs.
---

# RatAvert Backend API

## Context
The backend sits between the Raspberry Pi and the dashboard. The Pi reports detections; the dashboard reads them via REST and receives live updates via WebSocket.

## Before changing anything
1. Read `backend/server.js` and `backend/db.js` first. Do not assume endpoints or table names.
2. Check `frontend/src/api.js` to see which endpoints the dashboard already uses.

## Rules
1. Stack: Express, `ws`, `better-sqlite3`, `jsonwebtoken`, `bcryptjs`, `multer`. Do not add new dependencies without asking.
2. Keep authentication on protected routes. Passwords are always hashed with `bcryptjs`. Never store or log plain passwords.
3. Keep admin-only and user routes separate. Check the role in the route, not only in the frontend.
4. Never return demo or mock data. Every response comes from the database or the Pi.
5. Photos are saved in `backend/photos/`. Keep `.gitkeep`. Never commit real photos.
6. Secrets come from `.env`. Add new variables to `.env.example` (with placeholder values only). Never commit `.env`.
7. If an endpoint changes, update `frontend/src/api.js` in the same change.
8. Do not change deployment files (`railway.json`, `render.yaml`) unless asked.

## Testing
- Run with `npm run dev` inside `backend/`.
- Test each changed endpoint with valid and invalid input, and with admin and user roles.

## Output
- Summarize changes in bullets: files changed, endpoints added or changed, new env variables.