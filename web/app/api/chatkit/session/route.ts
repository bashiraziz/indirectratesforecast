export const runtime = "nodejs";

type CreateSessionBody = {
  workflow?: { id?: string };
  workflowId?: string;
};

const SESSION_COOKIE_NAME = "chatkit_session_id";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function apiBase(): string {
  const base = process.env.CHATKIT_API_BASE || "https://api.openai.com";
  return base.replace(/\/+$/, "");
}

function getWorkflowId(body: CreateSessionBody): string | null {
  const fromBody = body?.workflow?.id || body?.workflowId;
  const fromEnv = process.env.CHATKIT_WORKFLOW_ID;
  const id = (fromBody || fromEnv || "").trim();
  return id ? id : null;
}

function getOrCreateUserId(req: Request): { userId: string; setCookie?: string } {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const existing = match?.[1];
  if (existing) return { userId: existing };

  const userId = crypto.randomUUID();
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE_NAME}=${userId}`,
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return { userId, setCookie: parts.join("; ") };
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as CreateSessionBody;
  const workflowId = getWorkflowId(body);
  if (!workflowId) {
    return Response.json(
      { error: "Missing workflow id. Set CHATKIT_WORKFLOW_ID (recommended)." },
      { status: 400 }
    );
  }

  const { userId, setCookie } = getOrCreateUserId(req);

  const upstream = await fetch(`${apiBase()}/v1/chatkit/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "openai-beta": "chatkit_beta=v1",
    },
    body: JSON.stringify({ workflow: { id: workflowId }, user: userId }),
  }).catch((e) => {
    throw new Error(`Failed to reach ChatKit API: ${e instanceof Error ? e.message : String(e)}`);
  });

  const payload = (await upstream.json().catch(() => ({}))) as {
    client_secret?: string;
    expires_after?: unknown;
    error?: unknown;
  };

  if (!upstream.ok) {
    const msg =
      typeof payload.error === "string"
        ? payload.error
        : upstream.statusText || "Failed to create ChatKit session";
    return Response.json({ error: msg }, { status: upstream.status });
  }

  if (!payload.client_secret) {
    return Response.json({ error: "Missing client_secret in ChatKit response" }, { status: 502 });
  }

  const res = Response.json({ client_secret: payload.client_secret, expires_after: payload.expires_after });
  if (setCookie) res.headers.set("set-cookie", setCookie);
  return res;
}

