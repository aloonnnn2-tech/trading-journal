// A request body read with a size cap, for routes that take small JSON (an
// API key is at most 500 characters). Without one, `request.json()` buffers
// whatever arrives before any validation runs.

export type BoundedJson = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };

export async function readJsonLimited(request: Request, maxBytes: number): Promise<BoundedJson> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, status: 413, error: "Request too large" };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "Invalid body" };
  }
  // The header can be absent or wrong (chunked uploads); check what arrived.
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: "Request too large" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
}
