import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from './config.js';
import { evaluateAvailability, type ManualStatus } from './availability.js';

const app = Fastify({ logger: true });
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-dashboard-key': config.DASHBOARD_API_KEY } }
});
const statusBody = z.object({ status: z.enum(['available', 'busy', 'unavailable']) });
const loginBody = z.object({ code: z.string().min(1).max(256) });
type SettingsRow = { manual_status: ManualStatus; last_confirmed_at: string | null; updated_at: string };
const SESSION_COOKIE = 'nour_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
let loginFailures = 0;
let loginWindowStarted = Date.now();

await app.register(cors, { origin: config.CORS_ORIGIN.split(',').map((value) => value.trim()), credentials: true });

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function sessionSignature(timestamp: string): string {
  return createHmac('sha256', config.DASHBOARD_ACCESS_CODE).update(timestamp).digest('hex');
}
function getCookie(request: { headers: { cookie?: string } }): string | undefined {
  return request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
}
function hasSession(request: { headers: { cookie?: string } }): boolean {
  const value = getCookie(request);
  if (!value) return false;
  const [timestamp, signature] = value.split('.');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  return age >= 0 && age <= SESSION_TTL_SECONDS && safeEqual(signature, sessionSignature(timestamp));
}
function setSession(reply: { header: (name: string, value: string) => unknown }, value: string): void {
  reply.header('Set-Cookie', value);
}
function isAuthorized(request: { headers: { authorization?: string; cookie?: string } }): boolean {
  return request.headers.authorization === `Bearer ${config.DASHBOARD_API_KEY}` || hasSession(request);
}

app.get('/health', async () => ({ ok: true, service: 'nour-receptionist' }));
app.get('/', async (_request, reply) => {
  try {
    const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  } catch (error) {
    app.log.error(error, 'Could not load dashboard');
    return reply.code(500).send({ error: 'Dashboard unavailable' });
  }
});
app.post('/api/auth/login', async (request, reply) => {
  if (Date.now() - loginWindowStarted > 15 * 60 * 1000) { loginFailures = 0; loginWindowStarted = Date.now(); }
  if (loginFailures >= 8) return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
  const parsed = loginBody.safeParse(request.body);
  if (!parsed.success || !safeEqual(parsed.data.code, config.DASHBOARD_ACCESS_CODE)) {
    loginFailures += 1;
    return reply.code(401).send({ error: 'Incorrect access code.' });
  }
  loginFailures = 0;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const value = `${SESSION_COOKIE}=${timestamp}.${sessionSignature(timestamp)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
  setSession(reply, value);
  return { authenticated: true, expiresIn: SESSION_TTL_SECONDS };
});
app.get('/api/auth/session', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ authenticated: false });
  return { authenticated: true };
});
app.post('/api/auth/logout', async (_request, reply) => {
  setSession(reply, `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
  return { authenticated: false };
});

async function readSettings(): Promise<SettingsRow> {
  const { data, error } = await supabase.from('receptionist_settings').select('manual_status,last_confirmed_at,updated_at').eq('id', 'primary').single();
  if (error || !data) { app.log.error({ error }, 'Could not read receptionist settings'); throw new Error('Availability storage is unavailable'); }
  return data as SettingsRow;
}
async function writeSettings(values: Partial<SettingsRow>): Promise<SettingsRow> {
  const { data, error } = await supabase.from('receptionist_settings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', 'primary').select('manual_status,last_confirmed_at,updated_at').single();
  if (error || !data) { app.log.error({ error }, 'Could not update receptionist settings'); throw new Error('Could not update availability'); }
  return data as SettingsRow;
}
app.get('/api/status', async (_request, reply) => {
  try {
    const settings = await readSettings();
    return { ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at }), manualStatus: settings.manual_status, updatedAt: settings.updated_at };
  } catch { return reply.code(503).send({ error: 'Availability service temporarily unavailable' }); }
});
app.put('/api/status', async (request, reply) => {
  if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = statusBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid status. Use available, busy or unavailable.' });
  try {
    const now = new Date().toISOString();
    const settings = await writeSettings({ manual_status: parsed.data.status, last_confirmed_at: parsed.data.status === 'available' ? now : null });
    return { ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at }), manualStatus: settings.manual_status, updatedAt: settings.updated_at };
  } catch { return reply.code(503).send({ error: 'Could not update availability' }); }
});
app.post('/api/status/confirm', async (request, reply) => {
  if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized' });
  try {
    const settings = await writeSettings({ last_confirmed_at: new Date().toISOString() });
    return { ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at }), manualStatus: settings.manual_status, updatedAt: settings.updated_at };
  } catch { return reply.code(503).send({ error: 'Could not confirm availability' }); }
});
app.setErrorHandler((error, _request, reply) => { app.log.error(error); return reply.code(500).send({ error: 'Internal server error' }); });
try { await app.listen({ port: config.PORT, host: config.HOST }); }
catch (error) { app.log.error(error); process.exit(1); }
