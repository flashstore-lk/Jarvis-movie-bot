import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env.js';

export const supabase = isSupabaseConfigured
  ? createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

export async function recordSearch(jid: string, query: string, resultCount: number) {
  if (!supabase) return;
  const { error } = await supabase.from('search_history').insert({
    whatsapp_jid: jid,
    query,
    result_count: resultCount
  });
  if (error) console.error('Supabase search history error:', error.message);
}
