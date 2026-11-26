
import {
  BufferJSON,
  initAuthCreds,
  proto,
  useMultiFileAuthState,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore
} from "@whiskeysockets/baileys";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

import { env } from "../config/env";
import { supabase } from "../database/supabase";

const TABLE = "jarvis_auth_state";

type EncryptedRecord = {
  ciphertext: string;
  iv: string;
  auth_tag: string;
};

type AuthRecord = EncryptedRecord & {
  session_id: string;
  record_type: "creds" | "key";
  key_type: string;
  key_id: string;
  updated_at: string;
};

function usesSupabase(): boolean {
  if (env.authStorageDriver === "file") {
    return false;
  }

  if (env.authStorageDriver === "supabase") {
    return true;
  }

  return Boolean(
    supabase &&
    env.sessionSecret
  );
}

function getEncryptionKey(): Buffer {
  const secret = env.sessionSecret;

  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required for Supabase auth storage."
    );
  }

  let key: Buffer;

  if (/^[a-f0-9]{64}$/i.test(secret)) {
    key = Buffer.from(secret, "hex");
  } else {
    key = Buffer.from(secret, "base64");
  }

  if (key.length !== 32) {
    throw new Error(
      "SESSION_SECRET must be a 32-byte Base64 or 64-character hexadecimal key."
    );
  }

  return key;
}

function encryptValue(value: unknown): EncryptedRecord {
  const key = getEncryptionKey();
  const iv = randomBytes(12);

  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const plaintext = JSON.stringify(
    value,
    BufferJSON.replacer
  );

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64")
  };
}

function decryptValue<T>(
  record: EncryptedRecord
): T {
  const key = getEncryptionKey();

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64")
  );

  decipher.setAuthTag(
    Buffer.from(record.auth_tag, "base64")
  );

  const plaintext = Buffer.concat([
    decipher.update(
      Buffer.from(record.ciphertext, "base64")
    ),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(
    plaintext,
    BufferJSON.reviver
  ) as T;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured."
    );
  }

  return supabase;
}

function sessionId(): string {
  return env.sessionId;
}

async function saveCredentialRecord(
  creds: AuthenticationCreds
): Promise<void> {
  const encrypted = encryptValue(creds);

  const record: AuthRecord = {
    session_id: sessionId(),
    record_type: "creds",
    key_type: "",
    key_id: "",
    ...encrypted,
    updated_at: new Date().toISOString()
  };

  const { error } = await requireSupabase()
    .from(TABLE)
    .upsert(record, {
      onConflict:
        "session_id,record_type,key_type,key_id"
    });

  if (error) {
    throw new Error(
      `Could not save WhatsApp credentials: ${error.message}`
    );
  }
}

export async function createAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  if (!usesSupabase()) {
    return useMultiFileAuthState(env.authDir);
  }

  const db = requireSupabase();

  // Load credentials.
  const { data: credentialRecord, error } = await db
    .from(TABLE)
    .select(
      "ciphertext,iv,auth_tag"
    )
    .eq("session_id", sessionId())
    .eq("record_type", "creds")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load WhatsApp credentials: ${error.message}`
    );
  }

  const creds = credentialRecord
    ? decryptValue<AuthenticationCreds>(
        credentialRecord
      )
    : initAuthCreds();

  // Signal keys are loaded only when Baileys requests them.
  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{
      [id: string]: SignalDataTypeMap[T]
    }> {
      if (ids.length === 0) {
        return {};
      }

      const { data, error } = await db
        .from(TABLE)
        .select(
          "key_id,ciphertext,iv,auth_tag"
        )
        .eq("session_id", sessionId())
        .eq("record_type", "key")
        .eq("key_type", String(type))
        .in("key_id", ids);

      if (error) {
        throw new Error(
          `Could not load WhatsApp keys: ${error.message}`
        );
      }

      const result: Record<string, unknown> = {};

      for (const record of data || []) {
        let value = decryptValue<unknown>(
          record
        );

        if (
          type === "app-state-sync-key" &&
          value
        ) {
          value =
            proto.Message.AppStateSyncKeyData
              .fromObject(value as object);
        }

        result[record.key_id] = value;
      }

      return result as {
        [id: string]: SignalDataTypeMap[T]
      };
    },

    async set(data: SignalDataSet): Promise<void> {
      const tasks: Promise<void>[] = [];

      for (
        const type of Object.keys(data) as
          (keyof SignalDataTypeMap)[]
      ) {
        const entries = data[type];

        if (!entries) continue;

        const upserts: AuthRecord[] = [];
        const deletions: string[] = [];

        for (const [id, value] of Object.entries(entries)) {
          if (value === null || value === undefined) {
            deletions.push(id);
            continue;
          }

          upserts.push({
            session_id: sessionId(),
            record_type: "key",
            key_type: String(type),
            key_id: id,
            ...encryptValue(value),
            updated_at: new Date().toISOString()
          });
        }

        if (deletions.length > 0) {
          tasks.push(
            (async () => {
              const { error } = await db
                .from(TABLE)
                .delete()
                .eq("session_id", sessionId())
                .eq("record_type", "key")
                .eq("key_type", String(type))
                .in("key_id", deletions);

              if (error) {
                throw new Error(
                  `Could not delete WhatsApp keys: ${error.message}`
                );
              }
            })()
          );
        }

        if (upserts.length > 0) {
          tasks.push(
            (async () => {
              const { error } = await db
                .from(TABLE)
                .upsert(upserts, {
                  onConflict:
                    "session_id,record_type,key_type,key_id"
                });

              if (error) {
                throw new Error(
                  `Could not save WhatsApp keys: ${error.message}`
                );
              }
            })()
          );
        }
      }

      await Promise.all(tasks);
    },

    async clear(): Promise<void> {
      const { error } = await db
        .from(TABLE)
        .delete()
        .eq("session_id", sessionId())
        .eq("record_type", "key");

      if (error) {
        throw new Error(
          `Could not clear WhatsApp keys: ${error.message}`
        );
      }
    }
  };

  return {
    state: {
      creds,
      keys
    },

    saveCreds: async () => {
      await saveCredentialRecord(creds);
    }
  };
}

export async function clearStoredAuthState(): Promise<void> {
  if (!usesSupabase()) {
    return;
  }

  const { error } = await requireSupabase()
    .from(TABLE)
    .delete()
    .eq("session_id", sessionId());

  if (error) {
    throw new Error(
      `Could not clear stored WhatsApp session: ${error.message}`
    );
  }
}
