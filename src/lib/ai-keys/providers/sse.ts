/**
 * Server-Sent Events reader for provider streams.
 *
 * All three providers (OpenAI-compatible, Anthropic, Google's `alt=sse`)
 * stream as SSE: `data: <json>` lines separated by blank lines, sometimes
 * with `event:` lines, and OpenAI ends with a literal `data: [DONE]`. This
 * yields each `data` payload as a string and lets the adapter parse it --
 * the adapters differ only in what the JSON means.
 *
 * Written against the raw byte stream rather than a line-splitting helper
 * because network chunks land anywhere: mid-line, mid-multibyte-character,
 * or with several events in one chunk. The decoder is `stream: true` and the
 * buffer is carried across reads for exactly that reason.
 */
export async function* sseData(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string | null; data: string }> {
  const body = res.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Abort by cancelling the reader: that unwinds the pending read() with an
  // error, which the adapter maps to ProviderError("unavailable").
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalise line endings BEFORE looking for the blank line: a CRLF
      // stream's events end in "\r\n\r\n", which the "\n\n" search below never
      // finds, so every event would sit in the buffer until the stream closed
      // and be delivered as one block at the end -- streaming in name only.
      // A CR that is the last byte of a chunk is kept for the next one.
      buffer = normaliseNewlines(buffer + decoder.decode(value, { stream: true }));

      // An event ends at a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseEvent(raw);
        if (parsed) yield parsed;
      }
    }

    // A final event with no trailing blank line.
    buffer = normaliseNewlines(buffer + decoder.decode()).replace(/\r/g, "\n");
    const last = parseEvent(buffer);
    if (last) yield last;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * CRLF → LF, except a trailing lone CR, which may be the first half of a
 * CRLF split across chunks: it stays in the buffer until the next read.
 */
function normaliseNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/** One SSE event block → its `data` (multi-line data joined by "\n") and `event`. */
function parseEvent(block: string): { event: string | null; data: string } | null {
  let event: string | null = null;
  const data: string[] = [];

  for (const rawLine of block.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "" || line.startsWith(":")) continue; // blank or comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // The spec strips exactly one leading space after the colon.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    // id / retry are ignored: nothing here reconnects.
  }

  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}
