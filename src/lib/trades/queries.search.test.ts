import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTradesPage } from "./queries";

// Captures the string handed to `.or()`. That argument is the one place in
// listTradesPage that is filter *syntax* rather than a bound value, so it is
// the only thing a search term can influence structurally -- which makes it
// the thing worth asserting on.
//
// The fake is chainable and thenable because listTradesPage builds the query
// across several calls and then awaits the builder itself, the way PostgREST's
// client does.
function fakeSupabase(): { client: SupabaseClient; orArgs: string[] } {
  const orArgs: string[] = [];

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["eq", "gte", "lte", "contains", "order", "range", "select"]) {
    builder[method] = chain;
  }
  builder.or = (arg: string) => {
    orArgs.push(arg);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);

  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    orArgs,
  };
}

async function orStringFor(search: string): Promise<string> {
  const { client, orArgs } = fakeSupabase();
  await listTradesPage(client, { search });
  return orArgs[0];
}

describe("listTradesPage search filtering", () => {
  it("still searches both ticker and company name", async () => {
    const or = await orStringFor("AAPL");
    expect(or).toBe('ticker.ilike."%AAPL%",company_name.ilike."%AAPL%"');
  });

  // A comma is what PostgREST splits conditions on. Unquoted, "A,B" ended the
  // ticker condition early and turned the rest of the term into a condition of
  // its own -- the search box writing filter structure instead of being data.
  it("treats a comma as text, not as a condition separator", async () => {
    const or = await orStringFor("A,B");
    expect(or).toBe('ticker.ilike."%A,B%",company_name.ilike."%A,B%"');
    // Two conditions, both ours -- the comma inside the term must not add a third.
    expect(or.split("ilike").length - 1).toBe(2);
  });

  // Parentheses group conditions in PostgREST's filter grammar, so an
  // unbalanced one from user input could terminate the or() group early.
  it("treats parentheses as text, not as grouping", async () => {
    const or = await orStringFor("ABC)");
    expect(or).toBe('ticker.ilike."%ABC)%",company_name.ilike."%ABC)%"');
  });

  // A double quote is what ends a quoted value; a backslash is what escapes
  // it. Both have to be escaped or the term can close its own quoting and
  // resume being parsed as syntax.
  it("escapes quotes and backslashes so the term cannot end its own quoting", async () => {
    expect(await orStringFor('A"B')).toBe(
      'ticker.ilike."%A\\"B%",company_name.ilike."%A\\"B%"',
    );
    expect(await orStringFor("A\\B")).toBe(
      'ticker.ilike."%A\\\\B%",company_name.ilike."%A\\\\B%"',
    );
  });

  // LIKE wildcards are pattern code, not text. Left in, a search for "%"
  // matched every trade the user owns rather than the ones containing "%".
  it("strips LIKE wildcards so they cannot widen the match", async () => {
    expect(await orStringFor("A%B_C")).toBe(
      'ticker.ilike."%ABC%",company_name.ilike."%ABC%"',
    );
  });

  it("leaves a dotted term intact rather than reading it as column.operator", async () => {
    const or = await orStringFor("BRK.B");
    expect(or).toBe('ticker.ilike."%BRK.B%",company_name.ilike."%BRK.B%"');
  });
});
