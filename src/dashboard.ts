
import express, {
  type Request,
  type Response,
  type NextFunction
} from "express";

import { env } from "./config/env";
import { getWhatsAppStatus } from "./bot/connection";

const router = express.Router();

function auth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header =
    req.headers.authorization || "";

  const [scheme, token] = header.split(" ");

  if (scheme !== "Basic" || !token) {
    res.setHeader(
      "WWW-Authenticate",
      'Basic realm="JARVIS Admin"'
    );

    return res.status(401).send(
      "Authentication required"
    );
  }

  let decoded = "";

  try {
    decoded = Buffer
      .from(token, "base64")
      .toString("utf8");
  } catch {
    return res.status(401).send(
      "Invalid credentials"
    );
  }

  const separator = decoded.indexOf(":");

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  if (
    separator < 0 ||
    user !== env.dashboardUser ||
    pass !== env.dashboardPassword
  ) {
    return res.status(401).send(
      "Invalid credentials"
    );
  }

  next();
}

router.get(
  "/",
  auth,
  (_req: Request, res: Response) => {
    const status = getWhatsAppStatus();

    const account = status.account
      ? String(status.account).replace(
          /[&<>"]/g,
          ""
        )
      : "Not connected";

    const connectionColor = status.connected
      ? "#064e3b"
      : "#7f1d1d";

    const connectionText = status.connected
      ? "Connected"
      : "Disconnected";

    res.type("html").send(`
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        >

        <title>JARVIS Admin</title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            min-height: 100vh;
            background: #080d18;
            color: #eaf7ff;
            font-family: Arial, sans-serif;
            padding: 24px;
          }

          main {
            max-width: 720px;
            margin: 8vh auto;
            padding: 28px;
            border: 1px solid #164e63;
            border-radius: 18px;
            background: #0e1726;
          }

          h1 {
            color: #67e8f9;
          }

          .muted {
            color: #9fb3c8;
          }

          .pill {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 99px;
            background: ${connectionColor};
          }

          .card {
            margin-top: 20px;
            padding: 18px;
            background: #111f31;
            border-radius: 12px;
          }
        </style>
      </head>

      <body>
        <main>
          <h1>J.A.R.V.I.S.</h1>

          <p class="muted">
            WhatsApp Administration
          </p>

          <div class="card">
            <p>WhatsApp Connection</p>

            <span class="pill">
              ${connectionText}
            </span>
          </div>

          <div class="card">
            <p>Connected Account</p>
            <strong>${account}</strong>
          </div>

          <p class="muted">
            Starter dashboard — read only.
          </p>
        </main>
      </body>
      </html>
    `);
  }
);

export default router;
