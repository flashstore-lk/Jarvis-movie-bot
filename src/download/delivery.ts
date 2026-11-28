import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { sendDownloadedDocument, sendDownloadStatusText } from "../bot/connection";
import { updateDownloadJob } from "../database/supabase";

const router = express.Router();
const MAX_PART_BYTES = 70 * 1024 * 1024;

function verifyDeliveryToken(req: Request, res: Response, next: NextFunction) {
  const expected = env.downloadDeliveryToken;
  const supplied = req.header("x-download-token") || "";
  if (!expected || !supplied) return res.status(401).json({ success: false, message: "Unauthorized" });
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

function safeJid(value: string) {
  return /^\d{8,16}@s\.whatsapp\.net$/.test(value) || /^\d{5,25}-\d{5,25}@g\.us$/.test(value);
}

router.post("/file", verifyDeliveryToken, express.raw({ type: "application/octet-stream", limit: "70mb" }), async (req: Request, res: Response) => {
  const jobId = req.header("x-job-id") || "";
  const jid = req.header("x-target-jid") || "";
  let fileName = "jarvis-media.bin";
  let caption = "J.A.R.V.I.S. media delivery";
  try {
    fileName = decodeURIComponent(req.header("x-file-name") || fileName);
    caption = decodeURIComponent(req.header("x-caption") || caption);
  } catch {
    return res.status(400).json({ success: false, message: "Invalid encoded metadata." });
  }
  fileName = fileName.replace(/[\\/\0\r\n]/g, "_").slice(0, 180);
  caption = caption.slice(0, 900);
  const mimetype = (req.header("x-mime-type") || "application/octet-stream").slice(0, 120);
  const partNumber = Number(req.header("x-part-number") || "1");
  const totalParts = Number(req.header("x-total-parts") || "1");
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !safeJid(jid) || !Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > MAX_PART_BYTES) {
    return res.status(400).json({ success: false, message: "Invalid delivery request." });
  }
  if (!Number.isInteger(partNumber) || !Number.isInteger(totalParts) || partNumber < 1 || totalParts < partNumber || totalParts > 100) {
    return res.status(400).json({ success: false, message: "Invalid part metadata." });
  }
  try {
    await sendDownloadedDocument(jid, req.body, fileName, mimetype, caption);
    await updateDownloadJob(jobId, { status: "running", completedFiles: partNumber }).catch((error: unknown) => {
      console.error("[Download Delivery] Progress log failed:", error instanceof Error ? error.message : error);
    });
    return res.json({ success: true, jobId, partNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhatsApp delivery failed.";
    console.error("[Download Delivery] File send failed:", message);
    return res.status(503).json({ success: false, message });
  }
});

router.post("/status", verifyDeliveryToken, async (req: Request, res: Response) => {
  const jobId = String(req.body?.jobId || "");
  const jid = String(req.body?.targetJid || "");
  const state = String(req.body?.state || "");
  const message = String(req.body?.message || "").slice(0, 900);
  const completedFiles = Number(req.body?.completedFiles || 0);
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !safeJid(jid) || !["running", "completed", "failed"].includes(state)) {
    return res.status(400).json({ success: false, message: "Invalid status update." });
  }
  try {
    await updateDownloadJob(jobId, {
      status: state as "running" | "completed" | "failed",
      completedFiles,
      errorMessage: state === "failed" ? message : null
    });
    let notificationSent = true;
    if (state === "completed" || state === "failed") {
      try {
        await sendDownloadStatusText(
          jid,
          state === "completed"
            ? `✅ *Download complete*\n${message}\nJob: ${jobId.slice(0, 8)}`
            : `❌ *Download failed*\n${message}\nJob: ${jobId.slice(0, 8)}`
        );
      } catch (notifyError) {
        notificationSent = false;
        console.warn("[Download Delivery] Status WhatsApp notification failed:", notifyError instanceof Error ? notifyError.message : notifyError);
      }
    }
    return res.json({ success: true, notificationSent });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Status update failed.";
    console.error("[Download Delivery] Status update failed:", detail);
    return res.status(503).json({ success: false, message: detail });
  }
});

export default router;
