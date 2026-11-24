import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
    const body = await request.json();

    const phoneNumber = String(
      body?.phoneNumber || ""
    ).replace(/\D/g, "");

    if (!/^\d{8,15}$/.test(phoneNumber)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Enter a valid phone number with country code."
        },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${baseUrl}/pairing/code`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pairing-token": token
        },
        body: JSON.stringify({ phoneNumber }),
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
