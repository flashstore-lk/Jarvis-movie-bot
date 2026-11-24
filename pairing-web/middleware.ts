import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const username = process.env.SITE_USER;
  const password = process.env.SITE_PASSWORD;

  if (!username || !password) {
    return new NextResponse(
      "Website authentication is not configured.",
      { status: 503 }
    );
  }

  const authorization =
    request.headers.get("authorization");

  if (!authorization?.startsWith("Basic ")) {
    return new NextResponse(
      "Authentication required",
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="JARVIS Pairing"'
        }
      }
    );
  }

  try {
    const decoded = atob(
      authorization.slice(6)
    );

    const separator = decoded.indexOf(":");

    const user = decoded.slice(0, separator);
    const pass = decoded.slice(separator + 1);

    if (
      separator < 0 ||
      user !== username ||
      pass !== password
    ) {
      return new NextResponse(
        "Invalid credentials",
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Basic realm="JARVIS Pairing"'
          }
        }
      );
    }

    return NextResponse.next();

  } catch {
    return new NextResponse(
      "Invalid credentials",
      { status: 401 }
    );
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)"
  ]
};
