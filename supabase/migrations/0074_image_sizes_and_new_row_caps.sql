-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Apply after 0073. Safe before or after the code: without the new column
-- the upload route checks the file count only (and logs that the byte quota
-- is off), and every cap is far above anything live holds.
--
-- Security gaps pass, Phase 5 (items 5.1 and 5.2).
--
-- 1. trade_images.size_bytes: each screenshot's stored size, so the upload
--    route can hold one account to its storage quota (src/lib/limits.ts) with
--    one sum instead of listing every file in Storage. Existing rows are
--    filled in below from Storage's own record of each file's size. Live on
--    2026-10-18: 15 files, 0.4 MB in total.
--
-- 2. Row caps (0067's trigger) for the tables that came after 0067:
--    ai_proposals (0070), ai_review_versions and ai_review_messages (0071).
--    Each is skipped if its table isn't there yet, so this file is safe on a
--    database without 0071. Live on 2026-10-18: 6 review messages.

alter table public.trade_images
  add column if not exists size_bytes bigint;

alter table public.trade_images
  drop constraint if exists trade_images_size_bytes_range,
  add constraint trade_images_size_bytes_range check (
    size_bytes is null or (size_bytes >= 0 and size_bytes <= 10485760)
  );

-- Backfill: Storage keeps each object's size in its metadata. A row whose
-- file is gone stays null and counts as nothing, which is what it costs.
update public.trade_images ti
   set size_bytes = least((o.metadata ->> 'size')::bigint, 10485760)
  from storage.objects o
 where o.bucket_id = 'trade-images'
   and o.name = ti.storage_path
   and ti.size_bytes is null
   and (o.metadata ->> 'size') ~ '^[0-9]+$';

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('ai_proposals', 20000),
      ('ai_review_versions', 20000),
      ('ai_review_messages', 50000)
    ) as v(tbl, cap)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice 'skipped %: table not found (apply its migration, then this file again)', t.tbl;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_user_row_cap', t.tbl);
    execute format(
      'create trigger %I after insert on public.%I referencing new table as new_rows
         for each statement execute function public.enforce_user_row_cap(%L)',
      t.tbl || '_user_row_cap', t.tbl, t.cap::text);
  end loop;
end;
$$;

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0074_image_sizes_and_new_row_caps.sql')
on conflict do nothing;
