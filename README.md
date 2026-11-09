# Nour Receptionist

Cloud-first personal AI receptionist. Call handling and availability decisions run on hosted infrastructure; your phone is only an endpoint.

## Current milestone: availability API + private dashboard

The dashboard is served by the same backend at `/`. It supports secure code-based login, an HttpOnly session cookie, live availability, manual status controls, a 10-minute confirmation countdown and phone-presence heartbeats.

### Availability rules
- Time zone: `Europe/Stockholm` (automatically handles CET/CEST).
- After 18:00 local time: unavailable.
- Manual `available` is only effective before 18:00.
- Availability confirmation expires after 10 minutes.
- `busy` and `unavailable` are explicit manual states.
- Effective availability is computed on every request, not by a process-local timer.
- The signed-in dashboard sends a presence heartbeat every 25 seconds while its tab is visible.
- If no heartbeat arrives for 75 seconds, effective availability becomes `offline` (unavailable) automatically.
- Reopening the dashboard restores presence; the 10-minute availability confirmation must still be valid.
- This browser-based first version requires the dashboard to remain foregrounded. It is not yet a native background phone app.

## Stack
- Node.js 22 + TypeScript + Fastify
- Supabase Postgres with Row Level Security
- Private dashboard code exchanged for a signed, HttpOnly, Secure, SameSite=Strict session cookie
- Vitest and Render

## Environment
Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DASHBOARD_API_KEY`, and a separate random `DASHBOARD_ACCESS_CODE` (at least 24 characters). Never expose either credential in browser code or commit them.

## API
- `GET /health` — process health.
- `GET /` — private dashboard application.
- `POST /api/auth/login` — exchange dashboard access code for a 12-hour session cookie.
- `GET /api/auth/session` and `POST /api/auth/logout`.
- `GET /api/status` — effective availability.
- `PUT /api/status` — update manual status; requires a valid dashboard session or backend bearer credential.
- `POST /api/status/confirm` — renew the 10-minute confirmation; same authorization.
- `POST /api/presence/heartbeat` — authenticated foreground-device heartbeat.
- `POST /api/language/detect` — detect English, Swedish or Arabic and return localized receptionist phrases; requires dashboard session or backend bearer credential.

Update body: `{ "status": "available" }`. Allowed values: `available`, `busy`, `unavailable`.

## Language foundation
The first language-routing layer supports English (`en`), Swedish (`sv`) and Arabic (`ar`). Arabic script is detected directly; Swedish and English use lightweight word/character heuristics. The localized phrases are starter templates, not a full conversational model.

## Not connected yet
Telephony, speech recognition, generated voice, WhatsApp and call history are not active. Real spoken conversations require a speech/telephony provider and end-to-end tests. The dashboard labels these integrations as disconnected rather than implying they work.

## Privacy
This milestone does not record calls, audio or caller data. Before adding voice recording, transcription, WhatsApp or caller memory, implement clear disclosure, consent handling, retention limits and access controls.
