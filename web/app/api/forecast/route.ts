export const runtime = "nodejs";

function backendUrl(): string {
  const url = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  return url.replace(/\/+$/, "");
}

export async function POST(req: Request) {
  const form = await req.formData();

  const resp = await fetch(`${backendUrl()}/forecast`, {
    method: "POST",
    body: form,
  });

  // Pass-through content + headers (zip stream).
  const headers = new Headers(resp.headers);
  // Ensure this is downloadable even if backend didn't set it.
  if (!headers.get("content-disposition")) {
    headers.set("content-disposition", 'attachment; filename="rate_pack_output.zip"');
  }
  return new Response(resp.body, { status: resp.status, headers });
}

