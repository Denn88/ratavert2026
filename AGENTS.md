# RatAvert

## Project Overview
RatAvert is a capstone project (BSIT, Institute of Computing, Davao del Norte State College) by a three-person team. It is a rat detection system with a backend-connected web dashboard. All dashboard data comes from the backend, which only knows what the Raspberry Pi reports.

## Repository Structure
- `backend/`: Node.js backend. `server.js` (entry point), `db.js` (database connection), `photos/` (detection photos), `railway.json` and `render.yaml` (deployment configs), `.env.example` (environment variables template).
- `frontend/`: React + Vite dashboard. `src/App.jsx` (main UI), `src/api.js` (backend calls), `src/main.jsx` (entry), `vercel.json` (Vercel config).
- `pi/`: Raspberry Pi 3 B+ setup. `install.sh` (installer), `ratavert.service` (systemd service), `ratavert_client_example.py` (Python client example).
- `README.md`: production build notes.

## Tech Stack
- Hardware: Raspberry Pi 3 B+ (not Pi 4)
- Backend: Node.js, Express, REST + WebSocket (`ws`), SQLite (`better-sqlite3`), JWT auth (`jsonwebtoken`, `bcryptjs`), photo uploads (`multer`)
- Frontend: React 18 + Vite, hosted on Vercel (ratavert2026.vercel.app)
- Pi client: Python, run as a systemd service
- Note: the manuscript may describe Azure SQL. The current code uses SQLite. Do not change the database without asking.

## Conventions
- Documentation language: formal but simple.
- Always write "Raspberry Pi 3 B+".
- No demo or mock data in the dashboard. All data comes from the backend.
- Frontend API calls go through `frontend/src/api.js`.
- Do not paraphrase manuscript text. Formatting-only edits.

## Workflow Rules
- Work on a feature branch. Never commit directly to `main`.
- Commit messages: short and clear (for example: `docs: add AGENTS.md`).
- Ask before deleting files or restructuring folders.
- Never commit secrets. Only `.env.example` files belong in the repo, never `.env`.

## Commands
- Backend: `cd backend`, `npm install`, `npm start` (or `npm run dev` for watch mode)
- Frontend: `cd frontend`, `npm install`, `npm run dev` (build: `npm run build`, preview: `npm run preview`)