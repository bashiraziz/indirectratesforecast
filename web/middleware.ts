import { NextRequest, NextResponse } from "next/server";

// Routes that require authentication (redirect to sign-in if no session)
const PROTECTED_PATHS = [
  "/fiscal-years",
  "/pools",
  "/chart-of-accounts",
  "/cost-structure",
  "/mappings",
  "/scenarios",
  "/data",
];

// Paths that bypass middleware entirely
const BYPASS_PREFIXES = ["/_next", "/favicon.ico", "/api/auth", "/auth"];

/**
 * Fetch the current session by calling the Better Auth get-session endpoint.
 * This is an internal self-call so it works in any runtime environment.
 * Returns null on any error (treat as unauthenticated).
 */
async function getSession(
  request: NextRequest
): Promise<{ user: { id: string; email: string } } | null> {
  try {
    const authBase = process.env.BETTER_AUTH_URL || `http://localhost:3000`;
    const resp = await fetch(`${authBase}/api/auth/get-session`, {
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data ?? null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and auth routes
  if (BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // For proxied API calls to the FastAPI backend: inject X-User-ID if authenticated
  if (pathname.startsWith("/api/")) {
    const session = await getSession(request);
    if (session?.user?.id) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("X-User-ID", session.user.id);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return NextResponse.next();
  }

  // For protected frontend pages: redirect unauthenticated visitors to sign-in
  if (PROTECTED_PATHS.some((p) => pathname.startsWith(p))) {
    const session = await getSession(request);
    if (!session?.user) {
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all paths except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|.*\\.png$|.*\\.ico$).*)"],
};
