/**
 * The one shape every list-returning tool uses, so the model learns a single
 * convention for "there was more": `truncated` plus `total`, with `offset`
 * as the way to page. Replaces the ad-hoc `note` strings the first tools had.
 */
export interface Limited<T> {
  items: T[];
  returned: number;
  total: number;
  offset: number;
  truncated: boolean;
  hint?: string;
}

export function limited<T>(all: T[], limit: number, offset = 0, hint?: string): Limited<T> {
  const items = all.slice(offset, offset + limit);
  const truncated = offset + items.length < all.length;
  return {
    items,
    returned: items.length,
    total: all.length,
    offset,
    truncated,
    ...(truncated ? { hint: hint ?? `${all.length - offset - items.length} more; raise offset to page` } : {}),
  };
}

/**
 * Serialises a result to at most `max` characters.
 *
 * A paged result (`items`, or compute_stats' `groups`) that is too large is
 * re-cut to a smaller page rather than refused: on the free tier's 6 000
 * character ceiling a default 20-row `include: "notes"` page almost always
 * overflowed, and the model was told "narrow it" with nothing to show for
 * the call. Now it gets the rows that fit, `truncated: true`, and a hint
 * that says the page was cut. Anything else that is too large -- one huge
 * trade, a report -- becomes an error the model can read, never JSON cut
 * in half.
 */
export function fitToBudget(result: unknown, max: number): string {
  let json = JSON.stringify(result);
  if (json.length <= max) return json;

  const key = pagedKey(result);
  if (key) {
    const obj = result as Record<string, unknown> & { total?: number; offset?: number };
    const all = obj[key] as unknown[];
    let n = all.length;
    while (n > 1) {
      n = Math.floor(n / 2);
      const offset = typeof obj.offset === "number" ? obj.offset : 0;
      const total = typeof obj.total === "number" ? obj.total : all.length;
      const shrunk = {
        ...obj,
        [key]: all.slice(0, n),
        ...(key === "items" ? { returned: n } : {}),
        truncated: true,
        hint: `page cut to ${n} to fit the size limit; ${Math.max(0, total - offset - n)} more -- raise offset to page, or ask for less per row`,
      };
      json = JSON.stringify(shrunk);
      if (json.length <= max) return json;
    }
  }

  return JSON.stringify({
    error: "result too large",
    size: json.length,
    hint: "narrow the filter, lower the limit, or ask for one group at a time",
  });
}

function pagedKey(result: unknown): "items" | "groups" | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.items) && r.items.length > 1) return "items";
  if (Array.isArray(r.groups) && r.groups.length > 1) return "groups";
  return null;
}

/** A tool's error result -- the executor never throws, it returns this. */
export function toolError(message: string, extra: Record<string, unknown> = {}): { error: string } & Record<string, unknown> {
  return { error: message, ...extra };
}
