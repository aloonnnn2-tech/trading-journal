-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply it to the DEV project too, so the demo e2e test exercises it.
--
-- ORDER: any time. The app works without it: until the `is_demo` column
-- exists it detects that (src/lib/demo/keeps-own-trades.ts) and behaves as
-- before -- demo users skip the first-trade screen, and switching to your own
-- journal clears everything, as the confirmation then still says.
--
-- DOWN: re-run the two functions from 0051_demo_journal.sql (they restore
-- "clear everything"), then
--   alter table trades drop column if exists is_demo;
--   alter table strategies drop column if exists is_demo;
--   alter table account_transactions drop column if exists is_demo;
--
-- Why (Alon, 2026-11-19): a new user who takes the demo data should still be
-- able to log their own first trade, and keep it. Until now nothing told the
-- demo's rows from the user's, so "Switch to my own journal" deleted every
-- trade in the account. Now the demo's own rows carry is_demo = true, and the
-- switch removes only those.

alter table trades add column if not exists is_demo boolean not null default false;
alter table strategies add column if not exists is_demo boolean not null default false;
alter table account_transactions add column if not exists is_demo boolean not null default false;

-- ---- Accounts already in the demo -------------------------------------------
-- Mark what 0051's seed wrote, by the marks it left:
--   * a demo trade's created_at IS its entry_date (src/lib/demo/payload.ts,
--     "as if logged when it was placed"); a trade logged in the app gets the
--     moment it was saved, which is never exactly its own entry timestamp;
--   * the demo's strategies were all inserted in one transaction, the first
--     the account ever made, so they share its earliest created_at;
--   * the demo's starting balance is the one 25,000 "Starting balance" row.
update trades t
set is_demo = true
from user_settings us
where us.user_id = t.user_id
  and us.demo_state = 'active'
  and t.entry_date is not null
  and t.created_at = t.entry_date;

update strategies s
set is_demo = true
from user_settings us
where us.user_id = s.user_id
  and us.demo_state = 'active'
  and s.created_at = (select min(s2.created_at) from strategies s2 where s2.user_id = s.user_id);

update account_transactions a
set is_demo = true
from user_settings us
where us.user_id = a.user_id
  and us.demo_state = 'active'
  and a.note = 'Starting balance'
  and a.amount = 25000;

-- ---- seed_demo_journal ------------------------------------------------------
-- As 0051, with every row it writes marked is_demo.
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
    insert into strategies (user_id, name, description, color, sort_order, is_demo)
    values (uid, s->>'name', s->>'description', s->>'color', coalesce((s->>'sort_order')::int, 0), true)
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
      where k not in ('id', 'user_id', 'is_demo')
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'trades' and c.column_name = k
        );

    execute format(
      'insert into trades (user_id, is_demo, %1$s) select $1, true, %1$s from jsonb_populate_record(null::trades, $2) returning id',
      cols
    ) using uid, t->'row' into tid;

    for skey in select * from jsonb_array_elements_text(coalesce(t->'strategies', '[]'::jsonb)) loop
      if strategy_ids ? skey then
        insert into trade_strategies (trade_id, strategy_id)
        values (tid, (strategy_ids->>skey)::uuid)
        on conflict do nothing;
      end if;
    end loop;

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
    insert into account_transactions (user_id, amount, note, created_at, is_demo)
    values (
      uid,
      (payload->'deposit'->>'amount')::numeric,
      payload->'deposit'->>'note',
      coalesce((payload->'deposit'->>'created_at')::timestamptz, now()),
      true
    );
  end if;

  update user_settings set demo_state = 'active' where user_id = uid;
end;
$$;

-- ---- finish_demo_journal ------------------------------------------------------
-- "Switch to my own journal": removes the demo's own rows -- its trades, its
-- strategies (their rules and trade links go with them) and its starting
-- balance -- plus AI chats and reviews, which were written about the demo's
-- results. Everything the user added stays: their trades (with screenshots,
-- history and sales), strategies, folders, goals, fields and deposits.
--
-- Screenshot FILES of the removed trades are deleted by the app afterwards
-- (src/app/api/demo/route.ts), which now lists only the demo trades' files.
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

  delete from ai_conversations where user_id = uid;
  delete from ai_reviews where user_id = uid;
  delete from trades where user_id = uid and is_demo;
  delete from strategy_rules
    where user_id = uid and strategy_id in (select id from strategies where user_id = uid and is_demo);
  delete from strategies where user_id = uid and is_demo;
  delete from account_transactions where user_id = uid and is_demo;

  update user_settings set demo_state = 'done' where user_id = uid;
end;
$$;

revoke execute on function seed_demo_journal(jsonb) from public, anon;
revoke execute on function finish_demo_journal() from public, anon;
grant execute on function seed_demo_journal(jsonb) to authenticated;
grant execute on function finish_demo_journal() to authenticated;

notify pgrst, 'reload schema';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0082_demo_keeps_own_trades.sql')
on conflict do nothing;
