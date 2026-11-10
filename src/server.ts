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
type ConversationRow = { id: string; priority: 'normal' | 'urgent'; language: SupportedLanguage; stage: ConversationStage; status: 'open' | 'completed'; caller_name: string | null; caller_phone: string | null; intent: string | null; message: string | null; callback_requested: boolean | null; started_at: string; updated_at: string; completed_at: string | null };
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
    language: firstTurn.state.language, stage: firstTurn.state.stage, status: 'open', priority: firstTurn.state.priority, caller_phone: firstTurn.state.callerPhone
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

type AIConversationResult = {
  reply: string; callerName: string | null; callerPhone: string | null;
  intent: string | null; message: string | null; callbackRequested: boolean | null;
  priority: 'normal' | 'urgent'; completed: boolean;
};

async function generateReceptionistReply(
  transcript: Array<{ role: string; content: string }>,
  current: ConversationState
): Promise<AIConversationResult | null> {
  if (!config.OPENROUTER_API_KEY) {
    app.log.warn('OPENROUTER_API_KEY is missing; conversational AI is disabled');
    return null;
  }
  const system = [
    'You are Yazonis Secrettera, a capable human-style receptionist for ' + config.OWNER_NAME + '.',
    'Your job is to have a genuine conversation, not to run a questionnaire. Respond to the caller’s latest message in context. Be natural, concise, attentive and specific. Never repeat a question if the caller already answered it.',
    'Use the entire conversation history. A caller may give information out of order, correct earlier information, answer multiple questions at once, change their mind, or add details while you are asking something else. Understand the meaning rather than demanding yes/no answers.',
    'Ask at most ONE question in a reply, and only ask for information that is genuinely missing. If the caller gives a correction, acknowledge it and replace the old detail. If they give a callback time, retain it as part of the message. If they ask for a callback, record it; only ask for a phone number if no caller ID or number has been provided.',
    'Capture caller name/identity, phone or caller ID, the actual message/reason, callback preference and any preferred callback time. Keep the message faithful to the caller; do not invent facts. Keep all earlier details unless corrected.',
    'When enough details have been collected, read back a concise summary containing caller, phone (or Not provided), message, callback preference and priority. Then ask exactly one natural equivalent of “Would you like to add anything else?” Do not say goodbye yet.',
    'Only complete after the caller clearly says they have nothing else to add AFTER that final question. If they add anything, incorporate it and ask whether there is anything else again. A request for a callback is not consent to end the conversation.',
    'URGENT POLICY: identifying as the owner’s mother, father, sister, brother, parent or close family member is URGENT. Explicit emergencies and urgent/immediate requests are URGENT. A casual third-person mention is not enough. Never downgrade urgent priority.',
    'For a family caller, callerName should preserve their relationship (for example “Mother” or “Sister”); include their personal name too if provided.',
    'Reply in the language the caller is using: English, Swedish or Arabic. Preserve the language unless they switch.',
    'Return ONLY a JSON object with exactly these keys: reply, callerName, callerPhone, intent, message, callbackRequested, priority, completed. Use null for unknown fields. callbackRequested must be true, false or null. priority must be "normal" or "urgent". completed must be true or false. Do not use markdown.',
    'Current structured state: ' + JSON.stringify(current)
  ].join('\n');
  try {
    const messages = [
      { role: 'system' as const, content: system },
      ...transcript.map(item => ({
        role: (item.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: item.content
      }))
    ];
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.OPENROUTER_API_KEY,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://yazonis-secreterra.onrender.com',
        'X-OpenRouter-Title': 'Yazonis Secrettera'
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.65,
        max_tokens: 1100
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      app.log.error({
        status: response.status,
        model: config.OPENROUTER_MODEL,
        providerError: errorBody.slice(0, 1600),
        retryAfter: response.headers.get('retry-after')
      }, 'Conversational AI provider rejected the request');
      return null;
    }
    const payload = await response.json() as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | Array<{ type?: string; text?: string }> } }>
    };
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    const rawContent = (typeof content === 'string'
      ? content
      : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '').trim();
    const raw = rawContent
      .replace(/^\uFEFF/u, '')
      .replace(/^\s*```(?:json)?\s*/iu, '')
      .replace(/\s*```\s*$/u, '');
    let value: Partial<AIConversationResult> | null = null;
    try {
      value = JSON.parse(raw) as Partial<AIConversationResult>;
    } catch {
      const first = raw.indexOf('{');
      const last = raw.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try { value = JSON.parse(raw.slice(first, last + 1)) as Partial<AIConversationResult>; } catch { /* invalid model output */ }
      }
    }
    if (!value || typeof value.reply !== 'string' || !value.reply.trim()) {
      app.log.error({ model: config.OPENROUTER_MODEL, finishReason: choice?.finish_reason, content: rawContent.slice(0, 1200) }, 'Conversational AI returned unusable output');
      return null;
    }
    return {
      reply: value.reply.trim().slice(0, 2500),
      callerName: typeof value.callerName === 'string' && value.callerName.trim() ? value.callerName.trim().slice(0, 100) : null,
      callerPhone: typeof value.callerPhone === 'string' && value.callerPhone.trim() ? value.callerPhone.trim().slice(0, 40) : null,
      intent: typeof value.intent === 'string' && value.intent.trim() ? value.intent.trim().slice(0, 80) : null,
      message: typeof value.message === 'string' && value.message.trim() ? value.message.trim().slice(0, 2000) : null,
      callbackRequested: typeof value.callbackRequested === 'boolean' ? value.callbackRequested : null,
      priority: value.priority === 'urgent' ? 'urgent' : 'normal',
      completed: value.completed === true
    };
  } catch (error) {
    app.log.error({ error, model: config.OPENROUTER_MODEL }, 'Conversational AI request failed');
    return null;
  }
}

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
    priority: row.priority ?? 'normal', language: row.language, stage: row.stage, callerName: row.caller_name,
    callerPhone: row.caller_phone, intent: row.intent, message: row.message,
    callbackRequested: row.callback_requested
  };
  const transcriptResult = await supabase.from('receptionist_messages')
    .select('role,content').eq('conversation_id', row.id).order('created_at', { ascending: true });
  const aiResult = transcriptResult.error ? null : await generateReceptionistReply(
    (transcriptResult.data ?? []).map(message => ({ role: message.role, content: message.content })),
    current
  ).catch(error => { app.log.warn({ error }, 'OpenRouter request failed; using deterministic fallback'); return null; });
  const deterministicTurn = advanceConversation(current, parsed.data.text, config.OWNER_NAME);
  const callerText = parsed.data.text.trim();
  const urgentFamilyIdentity = /\b(i am|i'm|this is|it's|it is|calling|jag är|det är|ringer som)\b.{0,45}\b(mom|mum|mother|dad|father|sister|brother|parent|mamma|morsa|pappa|syster|bror|förälder)\b|\b(your|his|her|hans|hennes)\s+(mom|mum|mother|dad|father|sister|brother|mamma|pappa|syster|bror)\b|أنا (أمك|أبوك|والدتك|والدك|أختك|أخوك)/iu.test(callerText);
  const priority = current.priority === 'urgent' || aiResult?.priority === 'urgent' || urgentFamilyIdentity || deterministicTurn.state.priority === 'urgent' ? 'urgent' : 'normal';
  const normalized = callerText.toLowerCase().replace(/[.!؟?]+$/u, '').trim();
  const callerDeclinedExtra = current.stage === 'anything_else' && /^(no|nope|not really|that's all|that is all|that's it|that is it|nothing else|no thanks|all good|i'm good|im good|nej|nä|det var allt|inget mer|det räcker|nej tack|لا|كلا|ليس هناك شيء آخر|هذا كل شيء)$/iu.test(normalized);
  const mergeMessage = (...values: Array<string | null | undefined>): string | null => {
    const parts: string[] = [];
    for (const value of values) {
      const clean = value?.trim();
      if (!clean) continue;
      if (parts.some(part => part.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(part.toLowerCase()))) {
        const index = parts.findIndex(part => part.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(part.toLowerCase()));
        if (index >= 0 && clean.length > parts[index].length) parts[index] = clean;
        continue;
      }
      parts.push(clean);
    }
    return parts.join(' | ').slice(0, 2000) || null;
  };
  const callbackRequested = aiResult?.callbackRequested ?? deterministicTurn.state.callbackRequested ?? current.callbackRequested;
  const callerPhone = deterministicTurn.state.callerPhone ?? aiResult?.callerPhone ?? current.callerPhone;
  const callbackNeedsNumber = callbackRequested === true && !callerPhone;
  const modelAskedForMore = aiResult?.completed === true;
  const nextStage: ConversationStage = callerDeclinedExtra
    ? 'complete'
    : callbackNeedsNumber
      ? 'phone'
      : modelAskedForMore
        ? 'anything_else'
        : current.stage === 'anything_else'
          ? 'anything_else'
          : 'reason';
  const nextState: ConversationState = {
    priority,
    language: detectLanguage(callerText, current.language),
    stage: nextStage,
    callerName: urgentFamilyIdentity
      ? aiResult?.callerName ?? current.callerName ?? 'Yazoniii family member'
      : aiResult?.callerName ?? deterministicTurn.state.callerName ?? current.callerName,
    callerPhone,
    intent: aiResult?.intent ?? deterministicTurn.state.intent ?? current.intent,
    message: mergeMessage(current.message, deterministicTurn.state.message, aiResult?.message),
    callbackRequested
  };
  const finalSummary = deterministicTurn.reply;
  const languageCopy = {
    en: { ask: 'Would you like to add anything else?', goodbye: /\b(goodbye|bye|see you)\b[.!…]*/giu },
    sv: { ask: 'Vill du lägga till något mer?', goodbye: /\b(hej då|hejdå)\b[.!…]*/giu },
    ar: { ask: 'هل ترغب في إضافة أي شيء آخر؟', goodbye: /إلى اللقاء[.!…]*/gu }
  }[nextState.language];
  let responseText = aiResult?.reply ?? deterministicTurn.reply;
  if (callerDeclinedExtra) {
    responseText = finalSummary;
  } else if (callbackNeedsNumber && aiResult) {
    const asksNumber = /\b(number|phone|telephone|nummer|telefon|رقم|الهاتف)\b/iu.test(aiResult.reply);
    if (!asksNumber) responseText = nextState.language === 'sv'
      ? 'Vilket nummer ska jag be Yazoniii ringa tillbaka till?'
      : nextState.language === 'ar'
        ? 'ما الرقم الذي تريد من Yazoniii الاتصال بك عليه؟'
        : 'What number should Yazoniii call you back on?';
  } else if (modelAskedForMore) {
    const cleaned = responseText.replace(languageCopy.goodbye, '').trim();
    if (!cleaned.toLowerCase().includes(languageCopy.ask.toLowerCase())) responseText = cleaned + ' ' + languageCopy.ask;
  }
  const turn = {
    state: nextState,
    completed: callerDeclinedExtra,
    reply: responseText.trim().slice(0, 2500)
  };
  const now = new Date().toISOString();
  const update = await supabase.from('receptionist_conversations').update({
    language: turn.state.language, stage: turn.state.stage,
    status: turn.completed ? 'completed' : 'open',
    caller_name: turn.state.callerName, caller_phone: turn.state.callerPhone,
    intent: turn.state.intent, message: turn.state.message,
    callback_requested: turn.state.callbackRequested, priority: turn.state.priority, updated_at: now,
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
  return { conversationId: row.id, language: turn.state.language, stage: turn.state.stage, priority: turn.state.priority, completed: turn.completed, aiMode: aiResult ? 'ai' : 'fallback', reply: turn.reply };
});

app.get('/api/conversations', async (request, reply) => {
  if (!hasSession(request)) return reply.code(401).send({ error: 'Unauthorized' });
  const { data, error } = await supabase.from('receptionist_conversations')
    .select('id,language,status,priority,caller_name,caller_phone,intent,message,callback_requested,started_at,completed_at')
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
  // Messages reference the conversation without ON DELETE CASCADE, so remove them first.
  const { error: messagesError } = await supabase.from('receptionist_messages')
    .delete().eq('conversation_id', params.data.id);
  if (messagesError) {
    app.log.error({ error: messagesError }, 'Could not delete conversation messages');
    return reply.code(503).send({ error: 'Could not delete the conversation messages.' });
  }
  const { data, error } = await supabase.from('receptionist_conversations')
    .delete().eq('id', params.data.id).select('id').maybeSingle();
  if (error) {
    app.log.error({ error }, 'Could not delete receptionist conversation');
    return reply.code(503).send({ error: 'Could not delete this conversation.' });
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
