-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
--
-- The optional demo journal for new accounts (Phase 4D of
-- docs/design-audit.md, in the shape Alon chose on 2026-09-28):
--
--   * Before the first tour, once: "Start with a demo journal?"
--   * No  -> an empty journal, and the demo is never offered again.
--   * Yes -> the account is filled with a demo journal, an editable sandbox.
--            A one-time "Switch to my own journal" clears it for good.
--
-- The demo and the real journal never exist at the same time, so no query
-- anywhere needs to tell them apart, and demo figures can't mix into real
-- ones.
--
-- demo_state on user_settings:
--   null       not asked yet
--   declined   said no; never offered again
--   active     the demo journal is in the account
--   done       switched to their own journal; never offered again
--
-- NO column grant, on purpose (see 0024: this table is granted column by
-- column). The only way to change demo_state is through the three functions
-- below, which is what makes "never again" hold -- a user can't reset it to
-- null from the browser to re-seed, or skip straight to done.

alter table user_settings
  add column if not exists demo_state text
    check (demo_state in ('declined', 'active', 'done'));

-- Existing accounts are past their first login: nobody who already has a
-- trade or has finished the tour is asked. Only rows still null are touched,
-- so re-running this file changes nothing.
update user_settings us
set demo_state = 'declined'
where us.demo_state is null
  and (
    us.has_completed_tour
    or exists (select 1 from trades t where t.user_id = us.user_id)
  );

-- ---- seed_demo_journal ------------------------------------------------------
--
-- Inserts the demo journal the app sends (src/lib/demo/payload.ts builds it
-- from src/lib/demo/journal.json) and marks the account active, in ONE
-- transaction: a failure part-way leaves nothing behind and the question
-- still unanswered.
--
-- SECURITY DEFINER so it can set demo_state, which the user can't. Every row
-- it writes is forced to auth.uid(); nothing in the payload can name another
-- user. Trade rows are inserted column by column from the keys the payload
-- actually carries, so columns it omits take their table defaults -- a column
-- added by a later migration can't break the seed by arriving as null.
create or replace function seed_demo_journal(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s jsonb;
  r jsonb;
  t jsonb;
  h jsonb;
  sid uuid;
  tid uuid;
  skey text;
  strategy_ids jsonb := '{}'::jsonb;
  cols text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into user_settings (user_id) values (uid) on conflict (user_id) do nothing;
  perform 1 from user_settings where user_id = uid and demo_state is null for update;
  if not found then
    raise exception 'demo journal not available' using errcode = 'P0001', hint = 'demo_answered';
  end if;
  if exists (select 1 from trades where user_id = uid) then
    raise exception 'journal not empty' using errcode = 'P0001', hint = 'journal_not_empty';
  end if;

  for s in select * from jsonb_array_elements(coalesce(payload->'strategies', '[]'::jsonb)) loop
    insert into strategies (user_id, name, description, color, sort_order)
    values (uid, s->>'name', s->>'description', s->>'color', coalesce((s->>'sort_order')::int, 0))
    on conflict (user_id, name) do update set name = excluded.name
    returning id into sid;
    strategy_ids := strategy_ids || jsonb_build_object(s->>'key', sid);

    for r in select * from jsonb_array_elements(coalesce(s->'rules', '[]'::jsonb)) loop
      insert into strategy_rules (
        user_id, strategy_id, label, subject_source, subject_key, operator,
        number_value, number_value_max, text_value, enabled, sort_order
      ) values (
        uid, sid, r->>'label', r->>'subject_source', r->>'subject_key', r->>'operator',
        (r->>'number_value')::numeric, (r->>'number_value_max')::numeric, r->>'text_value',
        true, coalesce((r->>'sort_order')::int, 0)
      );
    end loop;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(payload->'trades', '[]'::jsonb)) loop
    select string_agg(quote_ident(k), ', ')
      into cols
      from jsonb_object_keys(t->'row') as k
      where k not in ('id', 'user_id')
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'trades' and c.column_name = k
        );

    execute format(
      'insert into trades (user_id, %1$s) select $1, %1$s from jsonb_populate_record(null::trades, $2) returning id',
      cols
    ) using uid, t->'row' into tid;

    for skey in select * from jsonb_array_elements_text(coalesce(t->'strategies', '[]'::jsonb)) loop
      if strategy_ids ? skey then
        insert into trade_strategies (trade_id, strategy_id)
        values (tid, (strategy_ids->>skey)::uuid)
        on conflict do nothing;
      end if;
    end loop;

    -- Pre-edit snapshots, for the few trades whose stop was moved: that is
    -- only visible in edit history (0008), so the demo writes it directly.
    for h in select * from jsonb_array_elements(coalesce(t->'history', '[]'::jsonb)) loop
      insert into trade_history (trade_id, user_id, snapshot, created_at)
      values (
        tid,
        uid,
        (h->'snapshot') || jsonb_build_object('id', tid, 'user_id', uid),
        coalesce((h->>'created_at')::timestamptz, now())
      );
    end loop;
  end loop;

  if payload ? 'deposit' then
    insert into account_transactions (user_id, amount, note, created_at)
    values (
      uid,
      (payload->'deposit'->>'amount')::numeric,
      payload->'deposit'->>'note',
      coalesce((payload->'deposit'->>'created_at')::timestamptz, now())
    );
  end if;

  update user_settings set demo_state = 'active' where user_id = uid;
end;
$$;

-- ---- finish_demo_journal ------------------------------------------------------
--
-- "Switch to my own journal": clears the journal and marks the demo done, in
-- one transaction. Everything the user added while trying the demo goes too
-- -- the app says so before they confirm. Account setup stays: settings,
-- AI keys and consents, commission rules, and the default fields (only
-- non-default field definitions are removed).
--
-- Screenshot FILES live in Storage, which SQL shouldn't reach into; the app
-- removes them after this succeeds (src/app/api/demo/route.ts). Their rows go
-- with the trades here.
create or replace function finish_demo_journal()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform 1 from user_settings where user_id = uid and demo_state = 'active' for update;
  if not found then
    raise exception 'no demo journal to finish' using errcode = 'P0001', hint = 'demo_not_active';
  end if;

  -- ai_messages cascade from ai_conversations; trade_history, trade_images,
  -- trade_strategies, trade_folders, trade_excursions and trade reviews
  -- cascade from trades.
  delete from ai_conversations where user_id = uid;
  delete from ai_reviews where user_id = uid;
  delete from trades where user_id = uid;
  delete from strategy_rules where user_id = uid;
  delete from strategies where user_id = uid;
  delete from folders where user_id = uid;
  delete from goals where user_id = uid;
  delete from account_transactions where user_id = uid;
  delete from field_definitions where user_id = uid and not is_default;

  update user_settings set demo_state = 'done' where user_id = uid;
end;
$$;

-- ---- decline_demo_journal -----------------------------------------------------
create or replace function decline_demo_journal()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into user_settings (user_id) values (uid) on conflict (user_id) do nothing;
  update user_settings set demo_state = 'declined' where user_id = uid and demo_state is null;
  if not found then
    raise exception 'demo journal already answered' using errcode = 'P0001', hint = 'demo_answered';
  end if;
end;
$$;

-- Signed-in users only. Functions are executable by PUBLIC by default.
revoke execute on function seed_demo_journal(jsonb) from public, anon;
revoke execute on function finish_demo_journal() from public, anon;
revoke execute on function decline_demo_journal() from public, anon;
grant execute on function seed_demo_journal(jsonb) to authenticated;
grant execute on function finish_demo_journal() to authenticated;
grant execute on function decline_demo_journal() to authenticated;

-- New functions are callable through PostgREST only once its schema cache
-- sees them; Supabase usually reloads on DDL, this makes it certain.
notify pgrst, 'reload schema';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0051_demo_journal.sql')
on conflict do nothing;
