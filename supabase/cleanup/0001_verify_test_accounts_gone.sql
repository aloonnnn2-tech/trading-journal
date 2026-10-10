-- Read-only check after 0001_delete_test_accounts.sql. Run in the Supabase
-- SQL editor of the LIVE project. Expected result: NO ROWS.
--
-- Lists any account that is still a cleanup candidate by the same rule as
-- scripts/list-accounts.ts (src/lib/accounts/classify.ts): a reserved test
-- domain, or the app's own domain other than the demo account. Plus any
-- screenshot file left in a deleted account's folder.

select 'account' as kind, u.id::text as id, u.email as detail, u.created_at
from auth.users u
where u.email ~* '@[^@]+\.(test|invalid|example|localhost)$'
   or (u.email ~* '@tradinglens\.app$' and lower(u.email) <> 'demo@tradinglens.app')

union all

select 'orphan file', o.id::text, o.name, o.created_at
from storage.objects o
where o.bucket_id = 'trade-images'
  and not exists (select 1 from auth.users u where u.id::text = split_part(o.name, '/', 1));
