import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { createDownloadJob, updateDownloadJob } from "../database/supabase";

export interface DownloadOption {
  label: string;
  url: string;
}

interface PendingDownload {
  chatJid: string;
  messageId: string;
  title: string;
  options: DownloadOption[];
  expiresAt: number;
}

// Keep several recent detail messages per chat so replies always select
// the movie whose quality list the user actually quoted.
const pending = new Map<string, PendingDownload>();
const PENDING_TTL_MS = 20 * 60 * 1000;
const MAX_PENDING_PER_CHAT = 10;
const keyOf = (jid: string, messageId: string) => `${jid}:${messageId}`;

export function rememberDownloadOptions(jid: string, messageId: string, title: string, options: DownloadOption[]) {
  const safeOptions = options.filter(x => /^https:\/\//i.test(x.url)).slice(0, 8);
  if (!messageId || !safeOptions.length) return;
  pending.set(keyOf(jid, messageId), {
    chatJid: jid,
    messageId,
    title: title.slice(0, 200),
    options: safeOptions,
    expiresAt: Date.now() + PENDING_TTL_MS
  });

  const chatItems = [...pending.entries()].filter(([, item]) => item.chatJid === jid);
  for (const [key] of chatItems.slice(0, Math.max(0, chatItems.length - MAX_PENDING_PER_CHAT))) pending.delete(key);
}

export function getDownloadOptions(jid: string, messageId?: string): PendingDownload | null {
  if (!messageId) return null;
  const key = keyOf(jid, messageId);
  const item = pending.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) {
    pending.delete(key);
    return null;
  }
  return item;
}

export async function queueDownload(jid: string, requestedBy: string, selection: string, quotedMessageId?: string) {
  if (!env.githubActionsToken) throw new Error("GITHUB_ACTIONS_TOKEN is not configured in Railway.");
  if (!env.downloadDeliveryToken) throw new Error("DOWNLOAD_DELIVERY_TOKEN is not configured in Railway.");
  if (!env.githubRepository) throw new Error("GITHUB_REPOSITORY is not configured in Railway.");
  if (!env.githubBranch) throw new Error("GITHUB_BRANCH is not configured in Railway.");
  if (!env.downloadWorkflow) throw new Error("DOWNLOAD_WORKFLOW is not configured in Railway.");

  const item = getDownloadOptions(jid, quotedMessageId);
  if (!item) throw new Error("මේ Movie Details message එකටම Reply කරන්න. විනාඩි 20කට පසු options කල් ඉකුත් වෙනවා.");

  const selected = selection.trim().toLowerCase();
  let options: DownloadOption[];
  if (selected === "all") {
    options = item.options;
  } else {
    const index = Number(selected);
    if (!Number.isInteger(index) || index < 1 || index > item.options.length + 1) {
      throw new Error(`Reply with a number from 1-${item.options.length + 1}.`);
    }
    options = index === item.options.length + 1
      ? item.options
      : [item.options[index - 1]];
  }

  const jobId = randomUUID();
  await createDownloadJob({
    jobId,
    jid,
    requestedBy,
    title: item.title,
    totalFiles: options.length
  });

  const payload = {
    jobId,
    targetJid: jid,
    requestedBy,
    title: item.title,
    links: options
  };

  const endpoint = `https://api.github.com/repos/${env.githubRepository}/actions/workflows/${encodeURIComponent(env.downloadWorkflow)}/dispatches`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.githubActionsToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "JARVIS-WhatsApp-Bot"
      },
      body: JSON.stringify({
        ref: env.githubBranch,
        inputs: { payload: JSON.stringify(payload) }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (response.status !== 204) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`GitHub Actions dispatch failed (${response.status}): ${detail}`);
    }
  } catch (error) {
    await updateDownloadJob(jobId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "GitHub dispatch failed"
    }).catch(() => undefined);
    throw error;
  }

  return { jobId, fileCount: options.length, title: item.title };
}
