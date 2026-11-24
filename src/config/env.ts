
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

export const env = {
  port: Number(process.env.PORT || 3000),

  nodeEnv:
    process.env.NODE_ENV || "development",

  dashboardUser:
    required("DASHBOARD_USER"),

  dashboardPassword:
    required("DASHBOARD_PASSWORD"),

  supabaseUrl:
    process.env.SUPABASE_URL || "",

  supabaseServiceRoleKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",

  authDir:
    process.env.AUTH_DIR || "/app/auth_info",

  tmdbApiKey:
    process.env.TMDB_API_KEY || ""
};
