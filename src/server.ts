import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { config } from './config.js';
import { evaluateAvailability, type ManualStatus } from './availability.js';

const app = Fastify({ logger: true });
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const statusBody = z.object({
  status: z.enum(['available', 'busy', 'unavailable'])
});

type SettingsRow = {
  manual_status: ManualStatus;
  last_confirmed_at: string | null;
  updated_at: string;
};

await app.register(cors, {
  origin: config.CORS_ORIGIN.split(',').map((value) => value.trim())
});

app.get('/health', async () => ({ ok: true, service: 'nour-receptionist' }));

async function readSettings(): Promise<SettingsRow> {
  const { data, error } = await supabase
    .from('receptionist_settings')
    .select('manual_status,last_confirmed_at,updated_at')
    .eq('id', 'primary')
    .single();

  if (error || !data) {
    app.log.error({ error }, 'Could not read receptionist settings');
    throw new Error('Availability storage is unavailable');
  }
  return data as SettingsRow;
}

async function writeSettings(values: Partial<SettingsRow>): Promise<SettingsRow> {
  const { data, error } = await supabase
    .from('receptionist_settings')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', 'primary')
    .select('manual_status,last_confirmed_at,updated_at')
    .single();

  if (error || !data) {
    app.log.error({ error }, 'Could not update receptionist settings');
    throw new Error('Could not update availability');
  }
  return data as SettingsRow;
}

function isAuthorized(authorization?: string): boolean {
  return authorization === `Bearer ${config.DASHBOARD_API_KEY}`;
}

app.get('/api/status', async (_request, reply) => {
  try {
    const settings = await readSettings();
    return {
      ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at }),
      manualStatus: settings.manual_status,
      updatedAt: settings.updated_at
    };
  } catch {
    return reply.code(503).send({ error: 'Availability service temporarily unavailable' });
  }
});

app.put('/api/status', async (request, reply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  const parsed = statusBody.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid status. Use available, busy or unavailable.' });
  }

  try {
    const now = new Date().toISOString();
    const settings = await writeSettings({
      manual_status: parsed.data.status,
      last_confirmed_at: parsed.data.status === 'available' ? now : null
    });
    return {
      ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at }),
      manualStatus: settings.manual_status,
      updatedAt: settings.updated_at
    };
  } catch {
    return reply.code(503).send({ error: 'Could not update availability' });
  }
});

app.post('/api/status/confirm', async (request, reply) => {
  if (!isAuthorized(request.headers.authorization)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  try {
    const settings = await writeSettings({ last_confirmed_at: new Date().toISOString() });
    return {
      ...evaluateAvailability({ manualStatus: settings.manual_status, lastConfirmedAt: settings.last_confirmed_at }),
      manualStatus: settings.manual_status,
      updatedAt: settings.updated_at
    };
  } catch {
    return reply.code(503).send({ error: 'Could not confirm availability' });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  return reply.code(500).send({ error: 'Internal server error' });
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
