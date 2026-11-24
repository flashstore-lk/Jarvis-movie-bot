import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl =
    process.env.RAILWAY_API_URL?.replace(/\/+$/, "");

  const token = process.env.PAIRING_API_TOKEN;

  if (!baseUrl || !token) {
    return NextResponse.json(
      {
        success: false,
        message: "Server configuration is missing."
      },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(
      `${baseUrl}/pairing/qr`,
      {
        headers: {
          "x-pairing-token": token
        },
        cache: "no-store"
      }
    );

    const data = await response.json();

    return NextResponse.json(
      data,
      {
        status: response.status,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Cannot reach the WhatsApp bot."
      },
      { status: 502 }
    );
  }
}
