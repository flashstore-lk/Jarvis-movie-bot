
import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}`
    );
  }

  return value;
}

const storageDriver =
  process.env.AUTH_STORAGE_DRIVER?.trim() || "auto";

if (
  !["auto", "supabase", "file"].includes(storageDriver)
) {
  throw new Error(
    "AUTH_STORAGE_DRIVER must be auto, supabase, or file."
  );
}

export const env = {
  port: Number(process.env.PORT || 3000),

  nodeEnv:
    process.env.NODE_ENV || "development",

  dashboardUser: required("DASHBOARD_USER"),

  dashboardPassword: required("DASHBOARD_PASSWORD"),

  pairingApiToken:
    process.env.PAIRING_API_TOKEN || "",

  supabaseUrl:
    process.env.SUPABASE_URL || "",

  supabaseServiceRoleKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",

  sessionSecret:
    process.env.SESSION_SECRET?.trim() || "",

  sessionId:
    process.env.SESSION_ID?.trim() || "jarvis-primary",

  authStorageDriver:
    storageDriver as "auto" | "supabase" | "file",

  authDir:
    process.env.AUTH_DIR || "/app/auth_info",

  tmdbApiKey:
    process.env.TMDB_API_KEY || ""
};
