import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const storageDriver = process.env.AUTH_STORAGE_DRIVER?.trim() || "auto";
if (!["auto", "supabase", "file"].includes(storageDriver)) {
  throw new Error("AUTH_STORAGE_DRIVER must be auto, supabase, or file.");
}

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  dashboardUser: required("DASHBOARD_USER"),
  dashboardPassword: required("DASHBOARD_PASSWORD"),
  pairingApiToken: process.env.PAIRING_API_TOKEN || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  sessionSecret: process.env.SESSION_SECRET?.trim() || "",
  sessionId: process.env.SESSION_ID?.trim() || "jarvis-primary",
  authStorageDriver: storageDriver as "auto" | "supabase" | "file",
  authDir: process.env.AUTH_DIR || "/app/auth_info",
  tmdbApiKey: process.env.TMDB_API_KEY || "",
  mochiApiKey: process.env.MOCHI_API_KEY?.trim() || "",
  cinesubzApiBaseUrl: (process.env.CINESUBZ_API_BASE_URL || "https://mochi-apis.koyeb.app").replace(/\/+$/, ""),
  githubActionsToken: process.env.GITHUB_ACTIONS_TOKEN?.trim() || "",
  downloadDeliveryToken: process.env.DOWNLOAD_DELIVERY_TOKEN?.trim() || "",
  githubRepository: process.env.GITHUB_REPOSITORY?.trim() || "flashstore-lk/Jarvis-movie-bot",
  githubBranch: process.env.GITHUB_BRANCH?.trim() || "main",
  downloadWorkflow: process.env.DOWNLOAD_WORKFLOW?.trim() || "download-worker.yml",
  ownerJid: process.env.OWNER_JID?.trim() || ""
};
