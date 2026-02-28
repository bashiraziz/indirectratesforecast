export const runtime = "nodejs";

const CANDIDATE_PORTS = [8000, 8001, 8080, 8888];

async function discoverBackendUrl(): Promise<string> {
  const explicit = process.env.BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  for (const port of CANDIDATE_PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (r.ok) return `http://127.0.0.1:${port}`;
    } catch {
      // port not responding, try next
    }
  }
  // Fall back to default
  return "http://127.0.0.1:8000";
}

export async function POST(req: Request) {
  const base = await discoverBackendUrl();

  // Read the raw body and forward with original Content-Type header
  // to avoid multipart FormData re-serialization issues.
  const body = await req.arrayBuffer();
  const forwardHeaders: Record<string, string> = {
    "content-type": req.headers.get("content-type") || "",
  };
  const userId = req.headers.get("x-user-id");
  if (userId) forwardHeaders["x-user-id"] = userId;

  const resp = await fetch(`${base}/forecast`, {
    method: "POST",
    headers: forwardHeaders,
    body,
  });

  // Pass-through content + headers (zip stream).
  const headers = new Headers(resp.headers);
  // Ensure this is downloadable even if backend didn't set it.
  if (!headers.get("content-disposition")) {
    headers.set("content-disposition", 'attachment; filename="rate_pack_output.zip"');
  }
  return new Response(resp.body, { status: resp.status, headers });
}
