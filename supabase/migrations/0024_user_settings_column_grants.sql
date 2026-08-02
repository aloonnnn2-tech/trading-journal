-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- PRIVILEGE ESCALATION FIX.
--
-- `is_admin` (added in 0013_analytics.sql) lives on user_settings, whose only
-- policy is "user_settings owner access" (0003): `for all using (auth.uid() =
-- user_id)`. That controls which *rows* a user may write -- Postgres RLS has
-- no way to express which *columns* they may write. So the policy happily
-- allowed a user to update their own row's is_admin to true.
--
-- The anon key is public by design (NEXT_PUBLIC_SUPABASE_ANON_KEY, shipped to
-- the browser in src/lib/supabase/client.ts), so this was exploitable from
-- devtools in one line:
--
--   supabase.from("user_settings").update({ is_admin: true }).eq("user_id", myId)
--
-- and is_admin gates: select on analytics_events / analytics_sessions (every
-- user's raw rows, per 0013's "admin select" policies) and all four
-- admin_* security-definer RPCs (platform-wide counts over auth.users).
--
-- Column-level GRANTs are the only mechanism that constrains this. RLS still
-- applies on top -- this adds the dimension RLS can't cover.

-- INSERT is granted too, not just UPDATE: setTourCompleted,
-- setDashboardLayout and setCoreFieldHidden (src/lib/settings/queries.ts) all
-- use upsert, which needs INSERT privilege on every column it names. Omitting
-- these would break saving settings entirely.
revoke insert, update on user_settings from authenticated;

grant insert (user_id, hidden_core_fields, timezone, dashboard_layout, has_completed_tour)
  on user_settings to authenticated;

grant update (hidden_core_fields, timezone, dashboard_layout, has_completed_tour)
  on user_settings to authenticated;

-- `select` is deliberately left alone: reading is_admin is what the app's own
-- isAdmin() check does. Only writing it is the problem. From here, is_admin is
-- settable only with the service-role key (i.e. from the Supabase dashboard).

-- Defense in depth: the join-table policies checked only one side ------------
-- Both policies verified you own the folder/strategy but never that you own
-- the *trade*, so a link row could be inserted pointing at someone else's
-- trade_id. Not exploitable for reading data (trades' own RLS still blocks the
-- row, and trade_id is an unguessable uuid), but the check belongs on both
-- sides of a join table.

drop policy if exists "trade_folders owner access" on trade_folders;
create policy "trade_folders owner access"
  on trade_folders for all
  using (
    exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from folders f where f.id = folder_id and f.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  );

drop policy if exists "trade_strategies owner access" on trade_strategies;
create policy "trade_strategies owner access"
  on trade_strategies for all
  using (
    exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from strategies s where s.id = strategy_id and s.user_id = auth.uid())
    and exists (select 1 from trades t where t.id = trade_id and t.user_id = auth.uid())
  );
