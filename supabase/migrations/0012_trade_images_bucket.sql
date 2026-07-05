-- Storage bucket + RLS policies for trade chart screenshots.
-- Path convention (see src/app/api/trades/[id]/images/route.ts): objects are
-- stored at "{user_id}/{trade_id}/{uuid}.{ext}", so (storage.foldername(name))[1]
-- is the owning user's id.
--
-- Best-effort migration inferred from application code; if the "trade-images"
-- bucket already exists in the live project with different policies, review
-- this against the live dashboard config before applying — the bucket insert
-- is idempotent (on conflict do nothing) so it won't clobber existing settings.

insert into storage.buckets (id, name, public)
values ('trade-images', 'trade-images', false)
on conflict (id) do nothing;

create policy "trade-images owner select"
  on storage.objects for select
  using (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trade-images owner insert"
  on storage.objects for insert
  with check (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trade-images owner update"
  on storage.objects for update
  using (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "trade-images owner delete"
  on storage.objects for delete
  using (bucket_id = 'trade-images' and (storage.foldername(name))[1] = auth.uid()::text);
