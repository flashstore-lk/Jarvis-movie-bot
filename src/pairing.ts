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

router.get(
  "/status",
  (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

    res.json({
      success: true,
      ...getWhatsAppStatus()
    });
  }
);

router.get(
  "/qr",
  (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

    const status = getWhatsAppStatus();

    if (status.connected) {
      return res.status(409).json({
        success: false,
        message: "WhatsApp is already connected."
      });
    }

    const qr = getLatestQr();

    if (!qr) {
      return res.status(409).json({
        success: false,
        message:
          "QR is not ready yet. Please try again shortly."
      });
    }

    res.json({
      success: true,
      qr
    });
  }
);

router.post(
  "/code",
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

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
        code
      });

    } catch (error) {
      console.error(
        "Pairing code request failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not generate pairing code."
      });
    }
  }
);

export default router;
