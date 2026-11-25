
import express, {
  type Request,
  type Response,
  type NextFunction
} from "express";

import { timingSafeEqual } from "node:crypto";

import { env } from "./config/env";

import {
  getWhatsAppStatus,
  getLatestQr,
  requestWhatsAppPairingCode
} from "./bot/connection";

const router = express.Router();

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

function verifyToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expected = env.pairingApiToken;
  const supplied = req.headers["x-pairing-token"];

  if (
    !expected ||
    typeof supplied !== "string"
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  if (
    a.length !== b.length ||
    !timingSafeEqual(a, b)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}

router.use(verifyToken);

// --------------------------------------------------
// STATUS
// --------------------------------------------------

router.get(
  "/status",
  (_req: Request, res: Response) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.json({
      success: true,
      ...getWhatsAppStatus()
    });
  }
);

// --------------------------------------------------
// QR CODE
// --------------------------------------------------

router.get(
  "/qr",
  (_req: Request, res: Response) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    const status = getWhatsAppStatus();

    if (status.connected) {
      return res.status(409).json({
        success: false,
        state: status.state,
        message: "WhatsApp is already connected."
      });
    }

    const qr = getLatestQr();

    if (!qr) {
      return res.status(503).json({
        success: false,
        state: status.state,
        message:
          "QR is not ready yet. Please wait and try again."
      });
    }

    res.json({
      success: true,
      state: status.state,
      qr
    });
  }
);

// --------------------------------------------------
// PAIRING CODE
// --------------------------------------------------

router.post(
  "/code",
  async (req: Request, res: Response) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    try {
      const phoneNumber = String(
        req.body?.phoneNumber || ""
      ).replace(/\D/g, "");

      if (!/^\d{8,15}$/.test(phoneNumber)) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid phone number with country code."
        });
      }

      const code =
        await requestWhatsAppPairingCode(
          phoneNumber
        );

      res.json({
        success: true,
        code,
        state: getWhatsAppStatus().state
      });

    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not generate pairing code.";

      console.error(
        "[Pairing] Pairing code request failed:",
        message
      );

      let statusCode = 500;

      if (
        message.includes("already connected")
      ) {
        statusCode = 409;
      } else if (
        message.includes("already processing")
      ) {
        statusCode = 429;
      } else if (
        message.includes("not ready") ||
        message.includes("logged out")
      ) {
        statusCode = 503;
      }

      res.status(statusCode).json({
        success: false,
        state: getWhatsAppStatus().state,
        message
      });
    }
  }
);

export default router;
