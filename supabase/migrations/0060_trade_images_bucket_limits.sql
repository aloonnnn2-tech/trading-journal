-- MANUAL APPLY REQUIRED: paste this file into the Supabase SQL editor and
-- run it. No Supabase CLI in this project -- migrations are applied by hand.
-- Safe to apply at any time: it only narrows what the storage API accepts
-- into the trade-images bucket, and the app never uploads anything outside
-- these limits.
--
-- Upload limits enforced by Storage itself (security hardening, Phase 4).
--
-- The upload route (src/app/api/trades/[id]/images/route.ts) checks type,
-- real image bytes, 5 MB and 50 megapixels, and re-encodes the image. But
-- the bucket had no limits of its own, and its policies (0012) let a signed-
-- in user write into their own folder directly through the Storage API with
-- their own token -- skipping the route and every check in it. So any file,
-- of any type and size, could be stored under the user's own prefix.
--
-- These limits apply to every upload into the bucket, whatever the path:
--   * 10 MB: the route caps input at 5 MB, but re-encoding (sharp) can grow
--     a heavily compressed image a little; 10 MB keeps the app's own uploads
--     well inside while still bounding a direct one.
--   * the four image types the route accepts. Storage checks the declared
--     content type here; the route additionally checks the actual bytes.
--     Not SVG -- the reason the route rejects it is that it can carry script.

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'trade-images';

-- Self-recording, as every migration since 0040.
insert into schema_migrations (filename)
values ('0060_trade_images_bucket_limits.sql')
on conflict do nothing;

-- Check after applying:
--   select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'trade-images';
