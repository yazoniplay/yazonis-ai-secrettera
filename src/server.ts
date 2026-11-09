import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from './config.js';
import { evaluateAvailability, type ManualStatus } from './availability.js';
import { detectLanguage, getReceptionPhrases, type SupportedLanguage } from './language.js';
import { advanceConversation, createConversation, type ConversationState, type ConversationStage } from './conversation.js';

const app = Fastify({ logger: true });
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-dashboard-key': config.DASHBOARD_API_KEY } }
});
const statusBody = z.object({ status: z.enum(['available', 'busy', 'unavailable']) });
const loginBody = z.object({ code: z.string().min(1).max(256) });
const languageBody = z.object({ text: z.string().min(1).max(2000), fallback: z.enum(['en', 'sv', 'ar']).optional() });
const conversationCreateBody = z.object({ language: z.enum(['en', 'sv', 'ar']).default('en'), callerPhone: z.string().trim().max(40).nullable().optional() });
const conversationMessageBody = z.object({ text: z.string().trim().min(1).max(2000) });
const conversationIdParams = z.object({ id: z.string().uuid() });
type ConversationRow = { id: string; language: SupportedLanguage; stage: ConversationStage; status: 'open' | 'completed'; caller_name: string | null; caller_phone: string | null; intent: string | null; message: string | null; callback_requested: boolean | null; started_at: string; updated_at: string; completed_at: string | null };
type SettingsRow = { manual_status: ManualStatus; last_confirmed_at: string | null; last_seen_at: string | null; updated_at: string };
const SESSION_COOKIE = 'yazonis_secrettera_session';
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

app.get('/health', async () => ({ ok: true, service: 'yazonis-secrettera' }));
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
  const { data, error } = await supabase.from('receptionist_settings').select('manual_status,last_confirmed_at,last_seen_at,updated_at').eq('id', 'primary').single();
  if (error || !data) { app.log.error({ error }, 'Could not read receptionist settings'); throw new Error('Availability storage is unavailable'); }
  return data as SettingsRow;
}
async function writeSettings(values: Partial<SettingsRow>): Promise<SettingsRow> {
  const { data, error } = await supabase.from('receptionist_settings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', 'primary').select('manual_status,last_confirmed_at,last_seen_at,updated_at').single();
  if (error || !data) { app.log.error({ error }, 'Could not update receptionist settings'); throw new Error('Could not update availability'); }
  return data as SettingsRow;
}
app.get('/api/status', async (_request, reply) => {
  try {
    const settings = await readSettings();
    return { ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at, lastSeenAt: settings.last_seen_at }), manualStatus: settings.manual_status, lastSeenAt: settings.last_seen_at, updatedAt: settings.updated_at };
  } catch { return reply.code(503).send({ error: 'Availability service temporarily unavailable' }); }
});
app.put('/api/status', async (request, reply) => {
  if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = statusBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid status. Use available, busy or unavailable.' });
  try {
    const now = new Date().toISOString();
    const settings = await writeSettings({ manual_status: parsed.data.status, last_confirmed_at: parsed.data.status === 'available' ? now : null, last_seen_at: parsed.data.status === 'available' ? now : undefined });
    return { ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at, lastSeenAt: settings.last_seen_at }), manualStatus: settings.manual_status, lastSeenAt: settings.last_seen_at, updatedAt: settings.updated_at };
  } catch { return reply.code(503).send({ error: 'Could not update availability' }); }
});
app.post('/api/status/confirm', async (request, reply) => {
  if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized' });
  try {
    const now = new Date().toISOString();
    const settings = await writeSettings({ last_confirmed_at: now, last_seen_at: now });
    return { ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at, lastSeenAt: settings.last_seen_at }), manualStatus: settings.manual_status, lastSeenAt: settings.last_seen_at, updatedAt: settings.updated_at };
  } catch { return reply.code(503).send({ error: 'Could not confirm availability' }); }
});
app.post('/api/presence/heartbeat', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  try {
    const settings = await writeSettings({ last_seen_at: new Date().toISOString() });
    return { ok: true, lastSeenAt: settings.last_seen_at };
  } catch {
    return reply.code(503).send({ error: 'Could not update device presence' });
  }
});

app.post('/api/language/detect', async (request, reply) => {
  if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = languageBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Provide text and an optional language fallback.' });
  const language: SupportedLanguage = detectLanguage(parsed.data.text, parsed.data.fallback ?? 'en');
  return { language, supportedLanguages: ['en', 'sv', 'ar'], responses: getReceptionPhrases(language) };
});


app.post('/api/conversations', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = conversationCreateBody.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: 'Choose en, sv or ar.' });
  const suppliedCallerPhone = parsed.data.callerPhone?.trim() || null;
  const firstTurn = createConversation(parsed.data.language, suppliedCallerPhone);
  const { data, error } = await supabase.from('receptionist_conversations').insert({
    language: firstTurn.state.language, stage: firstTurn.state.stage, status: 'open', caller_phone: firstTurn.state.callerPhone
  }).select('*').single();
  if (error || !data) {
    app.log.error({ error }, 'Could not create receptionist conversation');
    return reply.code(503).send({ error: 'Could not start a test conversation' });
  }
  const row = data as ConversationRow;
  const saved = await supabase.from('receptionist_messages').insert({
    conversation_id: row.id, role: 'assistant', content: firstTurn.reply, language: firstTurn.state.language
  });
  if (saved.error) {
    app.log.error({ error: saved.error }, 'Could not save conversation greeting');
    return reply.code(503).send({ error: 'Could not save conversation greeting' });
  }
  return { conversationId: row.id, language: firstTurn.state.language, stage: firstTurn.state.stage, reply: firstTurn.reply };
});

app.post('/api/conversations/:id/messages', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const params = conversationIdParams.safeParse(request.params);
  const parsed = conversationMessageBody.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Provide a valid conversation ID and message.' });
  const { data, error } = await supabase.from('receptionist_conversations').select('*').eq('id', params.data.id).single();
  if (error || !data) return reply.code(404).send({ error: 'Conversation not found.' });
  const row = data as ConversationRow;
  if (row.status === 'completed') return reply.code(409).send({ error: 'This conversation is already complete.' });
  const callerSaved = await supabase.from('receptionist_messages').insert({
    conversation_id: row.id, role: 'caller', content: parsed.data.text, language: row.language
  });
  if (callerSaved.error) {
    app.log.error({ error: callerSaved.error }, 'Could not save caller message');
    return reply.code(503).send({ error: 'Could not save your message.' });
  }
  const current: ConversationState = {
    language: row.language, stage: row.stage, callerName: row.caller_name,
    callerPhone: row.caller_phone, intent: row.intent, message: row.message,
    callbackRequested: row.callback_requested
  };
  const turn = advanceConversation(current, parsed.data.text, config.OWNER_NAME);
  const now = new Date().toISOString();
  const update = await supabase.from('receptionist_conversations').update({
    language: turn.state.language, stage: turn.state.stage,
    status: turn.completed ? 'completed' : 'open',
    caller_name: turn.state.callerName, caller_phone: turn.state.callerPhone,
    intent: turn.state.intent, message: turn.state.message,
    callback_requested: turn.state.callbackRequested, updated_at: now,
    completed_at: turn.completed ? now : null
  }).eq('id', row.id);
  if (update.error) {
    app.log.error({ error: update.error }, 'Could not update conversation state');
    return reply.code(503).send({ error: 'Could not update conversation state.' });
  }
  const assistantSaved = await supabase.from('receptionist_messages').insert({
    conversation_id: row.id, role: 'assistant', content: turn.reply, language: turn.state.language
  });
  if (assistantSaved.error) {
    app.log.error({ error: assistantSaved.error }, 'Could not save receptionist response');
    return reply.code(503).send({ error: 'Could not save receptionist response.' });
  }
  return { conversationId: row.id, language: turn.state.language, stage: turn.state.stage, completed: turn.completed, reply: turn.reply };
});

app.get('/api/conversations', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const { data, error } = await supabase.from('receptionist_conversations')
    .select('id,language,status,caller_name,caller_phone,intent,message,callback_requested,started_at,completed_at')
    .order('started_at', { ascending: false }).limit(30);
  if (error) {
    app.log.error({ error }, 'Could not list receptionist conversations');
    return reply.code(503).send({ error: 'Could not load saved messages.' });
  }
  return { conversations: data ?? [] };
});

app.delete('/api/conversations/:id', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const params = conversationIdParams.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid conversation ID.' });
  const { data, error } = await supabase.from('receptionist_conversations')
    .delete().eq('id', params.data.id).select('id').maybeSingle();
  if (error) {
    app.log.error({ error }, 'Could not delete receptionist conversation');
    return reply.code(503).send({ error: 'Could not delete this conversation. Check the database delete permission.' });
  }
  if (!data) return reply.code(404).send({ error: 'Conversation was not found or database permissions blocked the delete.' });
  return { deleted: true, conversationId: data.id };
});

app.get('/api/conversations/:id', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const params = conversationIdParams.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid conversation ID.' });
  const [conversation, messages] = await Promise.all([
    supabase.from('receptionist_conversations').select('*').eq('id', params.data.id).single(),
    supabase.from('receptionist_messages').select('id,role,content,language,created_at').eq('conversation_id', params.data.id).order('created_at', { ascending: true })
  ]);
  if (conversation.error || !conversation.data) return reply.code(404).send({ error: 'Conversation not found.' });
  if (messages.error) return reply.code(503).send({ error: 'Could not load conversation messages.' });
  return { conversation: conversation.data, messages: messages.data ?? [] };
});

app.setErrorHandler((error, _request, reply) => { app.log.error(error); return reply.code(500).send({ error: 'Internal server error' }); });
try { await app.listen({ port: config.PORT, host: config.HOST }); }
catch (error) { app.log.error(error); process.exit(1); }
