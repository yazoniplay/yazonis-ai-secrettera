import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  DASHBOARD_API_KEY: z.string().min(24),
  DASHBOARD_ACCESS_CODE: z.string().min(24),
  OWNER_NAME: z.string().trim().min(1).max(80).default('Yazoniii'),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_MODEL: z.string().trim().min(1).default('google/gemma-4-26b-a4b-it:free'),
  CORS_ORIGIN: z.string().default('http://localhost:3001')
});

export const config = schema.parse(process.env);
