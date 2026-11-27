import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import type { MovieResult } from "../services/types";

export const supabase =
  env.supabaseUrl && env.supabaseServiceRoleKey
    ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

function requireDb() {
  if (!supabase) throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return supabase;
}

export async function recordSearch(input: { jid: string; query: string; resultCount: number }) {
  if (!supabase) return;
  const { error } = await supabase.from("search_history").insert({
    wa_jid: input.jid, query: input.query.slice(0, 160), result_count: input.resultCount
  });
  if (error) console.error("Supabase insert failed:", error.message);
}

export async function saveLibraryItem(jid: string, list: "favorite" | "watchlist", movie: MovieResult) {
  const db = requireDb();
  const { error } = await db.from("user_library").upsert({
    wa_jid: jid,
    list_type: list,
    media_id: movie.id,
    media_type: movie.mediaType || "movie",
    title: movie.title,
    release_year: movie.year ?? null,
    rating: movie.rating ?? null,
    poster_url: movie.posterUrl ?? null,
    source_url: movie.sourceUrl ?? null
  }, { onConflict: "wa_jid,list_type,media_id,media_type" });
  if (error) throw new Error(error.message);
}

export async function listLibrary(jid: string, list: "favorite" | "watchlist") {
  const db = requireDb();
  const { data, error } = await db.from("user_library")
    .select("media_id,media_type,title,release_year,rating,source_url")
    .eq("wa_jid", jid).eq("list_type", list)
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function removeLibraryItem(jid: string, list: "favorite" | "watchlist", query: string) {
  const db = requireDb();
  const { error } = await db.from("user_library").delete()
    .eq("wa_jid", jid).eq("list_type", list)
    .or(`media_id.eq.${query},title.ilike.%${query.replace(/[,%()]/g, "")}%`);
  if (error) throw new Error(error.message);
}

export async function isAuthorizedAdmin(jid: string): Promise<boolean> {
  if (env.ownerJid && jid === env.ownerJid) return true;
  if (!supabase) return false;
  const { data, error } = await supabase.from("bot_admins").select("wa_jid").eq("wa_jid", jid).maybeSingle();
  if (error) {
    console.error("[Admin] Permission lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}

export async function isOwner(jid: string): Promise<boolean> {
  return Boolean(env.ownerJid && jid === env.ownerJid);
}

export async function addAdmin(jid: string, addedBy: string) {
  const db = requireDb();
  const { error } = await db.from("bot_admins").upsert({
    wa_jid: jid, permissions: ["settings:welcome"], added_by: addedBy
  }, { onConflict: "wa_jid" });
  if (error) throw new Error(error.message);
}

export async function removeAdmin(jid: string) {
  const db = requireDb();
  const { error } = await db.from("bot_admins").delete().eq("wa_jid", jid);
  if (error) throw new Error(error.message);
}

export async function adminCan(jid: string, permission: string): Promise<boolean> {
  if (await isOwner(jid)) return true;
  if (!supabase) return false;
  const { data, error } = await supabase.from("bot_admins")
    .select("permissions").eq("wa_jid", jid).maybeSingle();
  if (error || !data) return false;
  return Array.isArray(data.permissions) && data.permissions.includes(permission);
}

export async function setBotSetting(key: string, value: string, updatedBy: string) {
  const db = requireDb();
  const { error } = await db.from("bot_settings").upsert({
    setting_key: key, setting_value: value, updated_by: updatedBy, updated_at: new Date().toISOString()
  }, { onConflict: "setting_key" });
  if (error) throw new Error(error.message);
}

export async function getBotSetting(key: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("bot_settings")
    .select("setting_value").eq("setting_key", key).maybeSingle();
  if (error) {
    console.error("[Settings] Read failed:", error.message);
    return null;
  }
  return data?.setting_value ?? null;
}
