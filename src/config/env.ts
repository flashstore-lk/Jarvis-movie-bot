import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DASHBOARD_USER: z.string().min(1).default('admin'),
  DASHBOARD_PASSWORD: z.string().min(16, 'Use at least 16 characters'),
  SESSION_SECRET: z.string().min(32, 'Use at least 32 characters'),
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),
  TMDB_API_KEY: z.string().optional().or(z.literal('')),
  MEDIA_PROVIDER: z.enum(['disabled', 'authorized']).default('disabled')
});

export const env = schema.parse(process.env);
export const isSupabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
