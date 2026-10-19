import { describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { listAllAccounts, toBackupAccount } from "../../../scripts/backup-accounts";

const user = (id: string) =>
  ({
    id,
    email: `${id}@example.com`,
    email_confirmed_at: "2026-09-01T10:00:00Z",
    created_at: "2026-09-01T09:59:00Z",
    last_sign_in_at: null,
    app_metadata: { provider: "google", providers: ["google", 3] },
    user_metadata: { full_name: "Someone", avatar_url: "https://x" },
    identities: [{ id: "google-sub-1", identity_data: { sub: "google-sub-1" } }],
    phone: "+15550100",
    aud: "authenticated",
  }) as unknown as User;

describe("toBackupAccount", () => {
  it("keeps the six fields a restore needs, and nothing else", () => {
    const row = toBackupAccount(user("u1"));
    expect(row).toEqual({
      id: "u1",
      email: "u1@example.com",
      email_confirmed_at: "2026-09-01T10:00:00Z",
      created_at: "2026-09-01T09:59:00Z",
      last_sign_in_at: null,
      sign_in_methods: ["google"],
    });
    expect(JSON.stringify(row)).not.toMatch(/google-sub-1|Someone|avatar|5550100/);
  });
});

describe("listAllAccounts", () => {
  it("reads every page of users", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => user(`a${i}`)), [user("b0"), user("b1")]];
    const calls: number[] = [];
    const admin = {
      auth: {
        admin: {
          listUsers: async ({ page }: { page: number }) => {
            calls.push(page);
            return { data: { users: pages[page - 1] ?? [] }, error: null };
          },
        },
      },
    } as unknown as SupabaseClient;
    const all = await listAllAccounts(admin);
    expect(all).toHaveLength(1002);
    expect(calls).toEqual([1, 2]);
  });

  it("throws when the list can't be read, so the backup run fails loudly", async () => {
    const admin = { auth: { admin: { listUsers: async () => ({ data: null, error: { message: "down" } }) } } } as unknown as SupabaseClient;
    await expect(listAllAccounts(admin)).rejects.toEqual({ message: "down" });
  });
});
