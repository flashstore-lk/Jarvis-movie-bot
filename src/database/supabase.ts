
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

export const supabase =
  env.supabaseUrl && env.supabaseServiceRoleKey
    ? createClient(
        env.supabaseUrl,
        env.supabaseServiceRoleKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        }
      )
    : null;

export async function recordSearch(input: {
  jid: string;
  query: string;
  resultCount: number;
}) {
  if (!supabase) return;

  const { error } = await supabase
    .from("search_history")
    .insert({
      wa_jid: input.jid,
      query: input.query.slice(0, 160),
      result_count: input.resultCount
    });

  if (error) {
    console.error(
      "Supabase insert failed:",
      error.message
    );
  }
}
