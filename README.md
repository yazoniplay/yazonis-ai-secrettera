# Nour Receptionist

Cloud-first personal AI receptionist. The phone is an endpoint, not the runtime: call handling and availability decisions run on hosted infrastructure.

## Current milestone: availability API

This milestone establishes the backend contract and availability rules. Telephony, AI voice, WhatsApp and the desktop dashboard are not enabled until provider credentials and setup are configured.

### Availability rules
- Time zone: `Europe/Stockholm` (automatically handles CET/CEST).
- After 18:00 local time: unavailable.
- Manual `available` is only effective before 18:00.
- Availability confirmation expires after 10 minutes.
- `busy` and `unavailable` are explicit manual states.
- Effective availability is computed on every request, not by a process-local timer.

## Stack
- Node.js 22 + TypeScript + Fastify
- Supabase Postgres for persistent state
- Supabase publishable API key plus a private request credential, enforced by Row Level Security
- Vitest for tests
- Render for hosting

## Setup
1. Copy `.env.example` to `.env`.
2. Create a Supabase project and apply the SQL migrations in `supabase/migrations/`.
3. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and a long random `DASHBOARD_API_KEY`.
4. Store the same dashboard key in the private Supabase credential table using the secure migration/setup process; never expose it to a browser.
5. Run `npm install`, `npm run dev`, and `npm test`.

The service refuses to start without required configuration. Never commit credentials. Do not use a Supabase service-role or secret key in Render for this setup.

## API
- `GET /health` — process health only.
- `GET /api/status` — effective availability and rule explanation.
- `PUT /api/status` — update manual status. Requires `Authorization: Bearer <DASHBOARD_API_KEY>`.
- `POST /api/status/confirm` — confirm availability for another 10 minutes. Requires the same authorization.

Update body: `{ "status": "available" }`. Allowed values: `available`, `busy`, `unavailable`.

## Privacy
This milestone does not record calls, audio or caller data. Before adding voice recording, transcription, WhatsApp or caller memory, implement clear disclosure, consent handling, retention limits and access controls.
