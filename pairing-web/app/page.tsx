"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type BotStatus = {
  connected?: boolean;
  account?: string | null;
};

export default function Home() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [qr, setQr] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [status, setStatus] = useState<BotStatus>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshStatus() {
    try {
      const response = await fetch(
        "/api/pairing/status",
        { cache: "no-store" }
      );

      const data = await response.json();

      if (data.success) {
        setStatus(data);

        if (data.connected) {
          setQr("");
          setPairingCode("");
          setMessage("WhatsApp successfully connected.");
        }
      }
    } catch {
      // Status will retry on the next refresh.
    }
  }

  useEffect(() => {
    void refreshStatus();

    const timer = setInterval(() => {
      void refreshStatus();
    }, 4000);

    return () => clearInterval(timer);
  }, []);

  async function getQrCode() {
    setBusy(true);
    setMessage("");
    setPairingCode("");
    setQr("");

    try {
      let lastMessage = "QR is not ready yet.";

      // Give the Railway bot a short time to produce its QR.
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await fetch(
          "/api/pairing/qr",
          { cache: "no-store" }
        );

        const data = await response.json();

        if (data.success && data.qr) {
          setQr(data.qr);
          setMessage(
            "Open WhatsApp and scan this QR code."
          );
          return;
        }

        lastMessage = data.message || lastMessage;

        if (response.status !== 409) break;

        await new Promise(resolve =>
          setTimeout(resolve, 1200)
        );
      }

      setMessage(lastMessage);

    } catch {
      setMessage("Could not get the QR code.");
    } finally {
      setBusy(false);
    }
  }

  async function getPairingCode() {
    const cleanNumber = phoneNumber.replace(/\D/g, "");

    if (!/^\d{8,15}$/.test(cleanNumber)) {
      setMessage(
        "Enter your phone number with country code."
      );
      return;
    }

    setBusy(true);
    setMessage("");
    setQr("");
    setPairingCode("");

    try {
      const response = await fetch(
        "/api/pairing/code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            phoneNumber: cleanNumber
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Could not generate pairing code."
        );
      }

      setPairingCode(data.code);
      setMessage(
        "Enter this code in WhatsApp on your phone."
      );

    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="background-glow" />

      <section className="panel">
        <div className="brand">
          <div className="brand-icon">J</div>

          <div>
            <p className="eyebrow">WHATSAPP CONNECTION</p>
            <h1>J.A.R.V.I.S.</h1>
          </div>
        </div>

        <p className="subtitle">
          Securely link your WhatsApp account
          to your JARVIS Bot.
        </p>

        <div className="status-card">
          <span
            className={
              status.connected
                ? "status-dot online"
                : "status-dot offline"
            }
          />

          <div>
            <strong>
              {status.connected
                ? "WhatsApp Connected"
                : "Waiting for connection"}
            </strong>

            <p>
              {status.connected
                ? "Your bot is online."
                : "Choose a linking method below."}
            </p>
          </div>

          <span className="status-label">
            {status.connected ? "ONLINE" : "OFFLINE"}
          </span>
        </div>

        {!status.connected && (
          <>
            <div className="section-heading">
              <span>01</span>
              <div>
                <h2>Enter phone number</h2>
                <p>
                  Include your country code.
                  Example: 94771234567
                </p>
              </div>
            </div>

            <label htmlFor="phone">
              WHATSAPP PHONE NUMBER
            </label>

            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="94771234567"
              value={phoneNumber}
              onChange={event =>
                setPhoneNumber(event.target.value)
              }
            />

            <div className="section-heading second">
              <span>02</span>
              <div>
                <h2>Choose linking method</h2>
                <p>
                  Use either QR or Pairing Code.
                </p>
              </div>
            </div>

            <div className="actions">
              <button
                className="secondary-button"
                onClick={getQrCode}
                disabled={busy}
              >
                {busy ? "Please wait..." : "Get QR Code"}
              </button>

              <button
                className="primary-button"
                onClick={getPairingCode}
                disabled={busy}
              >
                {busy
                  ? "Please wait..."
                  : "Get Pairing Code"}
              </button>
            </div>

            {qr && (
              <div className="result-card">
                <h3>Scan QR Code</h3>

                <p>
                  Open WhatsApp → Linked Devices
                  → Link a Device.
                </p>

                <div className="qr-frame">
                  <QRCodeSVG
                    value={qr}
                    size={230}
                    level="M"
                    includeMargin
                  />
                </div>

                <p className="small-note">
                  Use the latest QR code. It may expire
                  and refresh automatically on the bot.
                </p>
              </div>
            )}

            {pairingCode && (
              <div className="result-card">
                <h3>Your Pairing Code</h3>

                <div className="pairing-code">
                  {pairingCode}
                </div>

                <p>
                  On your phone, open WhatsApp →
                  Linked Devices → Link a Device →
                  Link with phone number instead.
                </p>

                <p className="small-note">
                  Enter the displayed code in WhatsApp.
                  Do not share it with anyone.
                </p>
              </div>
            )}
          </>
        )}

        {status.connected && (
          <div className="connected-card">
            <div className="success-icon">✓</div>
            <h2>Connection complete</h2>
            <p>
              JARVIS is now connected to WhatsApp.
            </p>
          </div>
        )}

        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}

        <div className="security-note">
          <span>🔒</span>
          <p>
            Keep your QR code and pairing code private.
            Anyone who obtains them may be able to link
            a device to your WhatsApp account.
          </p>
        </div>

        <footer>
          JARVIS MOVIE BOT <span>•</span> SECURE LINKING
        </footer>
      </section>
    </main>
  );
}
