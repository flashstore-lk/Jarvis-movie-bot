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
  if (!supabase) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return supabase;
}

export async function recordSearch(input: { jid: string; query: string; resultCount: number }) {
  if (!supabase) return;
  const { error } = await supabase.from("search_history").insert({
    wa_jid: input.jid,
    query: input.query.slice(0, 160),
    result_count: input.resultCount
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
  const safeQuery = query.replace(/[,%()]/g, "");
  const { error } = await db.from("user_library").delete()
    .eq("wa_jid", jid).eq("list_type", list)
    .or(`media_id.eq.${safeQuery},title.ilike.%${safeQuery}%`);
  if (error) throw new Error(error.message);
}

export async function isOwner(jid: string): Promise<boolean> {
  return Boolean(env.ownerJid && normalizeJid(jid) === normalizeJid(env.ownerJid));
}

function normalizeJid(jid: string) {
  const value = jid.trim().toLowerCase().replace(/:\d+(?=@)/, "");
  if (!value) return "";
  if (value.includes("@")) return value;
  if (/^\d{8,16}$/.test(value)) return `${value}@s.whatsapp.net`;
  return value;
}

export async function isAuthorizedAdmin(jid: string): Promise<boolean> {
  if (await isOwner(jid)) return true;
  if (!supabase) return false;
  const { data, error } = await supabase.from("bot_admins")
    .select("wa_jid").eq("wa_jid", normalizeJid(jid)).maybeSingle();
  if (error) {
    console.error("[Admin] Permission lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}

export async function addAdmin(jid: string, addedBy: string) {
  const db = requireDb();
  const { error } = await db.from("bot_admins").upsert({
    wa_jid: normalizeJid(jid),
    permissions: ["settings:welcome"],
    added_by: normalizeJid(addedBy)
  }, { onConflict: "wa_jid" });
  if (error) throw new Error(error.message);
}

export async function removeAdmin(jid: string) {
  const db = requireDb();
  const { error } = await db.from("bot_admins").delete().eq("wa_jid", normalizeJid(jid));
  if (error) throw new Error(error.message);
}

export async function adminCan(jid: string, permission: string): Promise<boolean> {
  if (await isOwner(jid)) return true;
  if (!supabase) return false;
  const { data, error } = await supabase.from("bot_admins")
    .select("permissions").eq("wa_jid", normalizeJid(jid)).maybeSingle();
  if (error) {
    console.error("[Admin] Permission lookup failed:", error.message);
    return false;
  }
  if (!data) return false;
  const permissions: unknown = data.permissions;
  return Array.isArray(permissions) &&
    (permissions.includes("*") || permissions.includes(permission));
}

export async function setAdminPermissions(jid: string, permissions: string[]) {
  const db = requireDb();
  const { error } = await db.from("bot_admins")
    .update({ permissions }).eq("wa_jid", normalizeJid(jid));
  if (error) throw new Error(error.message);
}

export async function listAdmins(): Promise<Array<{ wa_jid: string; permissions: string[] }>> {
  const db = requireDb();
  const { data, error } = await db.from("bot_admins")
    .select("wa_jid,permissions").limit(100);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    wa_jid: String(row.wa_jid),
    permissions: Array.isArray(row.permissions) ? row.permissions.filter((x): x is string => typeof x === "string") : []
  }));
}

export async function setBotSetting(key: string, value: string, updatedBy: string) {
  const db = requireDb();
  const { error } = await db.from("bot_settings").upsert({
    setting_key: key,
    setting_value: value,
    updated_by: normalizeJid(updatedBy),
    updated_at: new Date().toISOString()
  }, { onConflict: "setting_key" });
  if (error) throw new Error(error.message);
}

export async function getBotSetting(key: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("bot_settings")
    .select("setting_value").eq("setting_key", key).maybeSingle();
  if (error) {
    console.error(`[Settings] Read failed (${key}):`, error.message);
    return null;
  }
  return typeof data?.setting_value === "string" ? data.setting_value : null;
}

export async function getBotSettings(keys: string[]): Promise<Record<string, string | null>> {
  if (!supabase || keys.length === 0) return Object.fromEntries(keys.map((key) => [key, null]));
  const { data, error } = await supabase.from("bot_settings")
    .select("setting_key,setting_value").in("setting_key", keys);
  if (error) {
    console.error("[Settings] Bulk read failed:", error.message);
    return Object.fromEntries(keys.map((key) => [key, null]));
  }
  const result: Record<string, string | null> = Object.fromEntries(keys.map((key) => [key, null]));
  for (const row of data || []) {
    if (typeof row.setting_key === "string") {
      result[row.setting_key] = typeof row.setting_value === "string" ? row.setting_value : null;
    }
  }
  return result;
}

export type DownloadJobStatus = "queued" | "running" | "completed" | "failed";

export async function createDownloadJob(input: {
  jobId: string;
  jid: string;
  requestedBy: string;
  title: string;
  totalFiles: number;
}) {
  const db = requireDb();
  const { error } = await db.from("download_jobs").insert({
    job_id: input.jobId,
    wa_jid: input.jid,
    requested_by: input.requestedBy,
    title: input.title.slice(0, 250),
    total_files: input.totalFiles,
    completed_files: 0,
    status: "queued"
  });
  if (error) throw new Error(`Could not create download job: ${error.message}`);
}

export async function updateDownloadJob(
  jobId: string,
  patch: {
    status?: DownloadJobStatus;
    completedFiles?: number;
    errorMessage?: string | null;
  }
) {
  const db = requireDb();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.completedFiles !== undefined) {
    update.completed_files = Math.max(0, Math.floor(patch.completedFiles));
  }
  if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage?.slice(0, 900) ?? null;

  const { error } = await db.from("download_jobs").update(update).eq("job_id", jobId);
  if (error) throw new Error(`Could not update download job: ${error.message}`);
}
