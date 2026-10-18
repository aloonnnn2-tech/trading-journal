# Backup restore test (the drill)

From the security gaps pass, item 6.2 ([02-gaps-report.md](02-gaps-report.md)).
A backup only counts once it has been restored. **Alon runs this drill. It
writes nothing to live**: it restores the newest live backup into a brand-new,
throwaway Supabase project, compares it, then deletes that project.

Plan on 30–45 minutes the first time. Run it again after any change to the
backup or restore scripts, and at least every three months. Record each run
in the log at the bottom.

## What Supabase gives you (checked 2026-10-18)

From [Supabase's backup docs](https://supabase.com/docs/guides/platform/backups):

- **Free plan: no backups from Supabase, and no point-in-time recovery.**
  Supabase's daily backups start on Pro (last 7 days) and Team (last 14
  days). Point-in-time recovery is a paid add-on on top of those.
- **Storage files are never in Supabase's database backups**, on any plan.
- So the only copies of Trading Lens's data are the encrypted GitHub
  Actions artifacts from `.github/workflows/backup.yml`: daily, kept 30
  days, and weekly, kept 90 days. They hold every user table and the
  screenshots.

**What the backups don't hold:** sign-in accounts (`auth.users`: emails and
passwords), the schema, the waitlist, and the short-lived operational
tables (`scripts/db-tables.ts`, `BACKUP_EXCLUDED`). The schema comes from
the migrations. The accounts are recreated by id with placeholder emails
(step 4). People getting back into their real accounts after a total loss
is not covered today: see Q13 in the report.

## What was already proven, by Claude, on the dev project (2026-10-18)

- **Same-project round trip:** dev backup, then restore into dev, gives the
  same row count in every table (1,515 rows, 28 tables). Backup 5.6 s,
  restore 3.3 s.
- **Fresh-account restore:** an account with a strategy, a
  strategy-specific custom field, folders, links and history was backed up
  and deleted, recreated by id (`restore-auth-placeholders.ts`), then
  restored. All 25 rows came back, and the trade was identical.
- The drill found and fixed one bug: `field_definitions` was restored
  before `strategies`, which a fresh-project restore would have failed on.

What hasn't been proven is the whole thing at once: live's real backup, a
fresh project, and the screenshots. That's this drill.

## Before you start

- [ ] The backup passphrase, from your password manager.
- [ ] Git Bash with `gpg` (it comes with Git for Windows) and this repo,
      with `npm ci` done.
- [ ] Room for one more free Supabase project. The free plan allows only
      a small number of active projects (check **Dashboard → your
      organization**). If it won't let you create one, **pause the dev
      project** for the drill and resume it afterwards. Don't restore into
      the dev project itself: e2e tests and scripts use its keys, and live
      users' data has no business there.
- [ ] Write down the start time.

## Steps

1. **Get the newest backup.** GitHub → Actions → "Backup database" → the
   latest green run → download the artifact and unzip it. Note the stamp in
   the file name.

2. **Decrypt and unpack**, in Git Bash at the repo root. `read -s` keeps
   the passphrase off the screen, out of your shell history and off the
   process list:

   ```bash
   read -rs BACKUP_PASSPHRASE; printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --decrypt --passphrase-fd 0 trading-lens-backup-<stamp>.tar.gz.gpg > backup.tar.gz; unset BACKUP_PASSPHRASE
   tar -xzf backup.tar.gz        # gives backups/<stamp>/
   ```

3. **Create the throwaway project.** Supabase → New project, named
   `tl-restore-test-<date>`. Then:
   - SQL editor: paste all of `supabase/dev/schema.sql` and run it. It is
     every migration in order, the screenshot bucket included. Use the file
     from the same code that is live (`main`). If it fails, write down the
     error: that is a finding in itself.
   - Project Settings → API: copy the URL and the `service_role` key into a
     new file at the repo root, `.env.restore-test.local` (git ignores
     `.env*`):

     ```
     NEXT_PUBLIC_SUPABASE_URL=<throwaway project URL>
     SUPABASE_SERVICE_ROLE_KEY=<throwaway service_role key>
     ```

   **Every command below passes this file explicitly.** Never use the
   `npm run restore:*` shortcuts in this drill: they read `.env.local`,
   which is live. Each script prints `Target:` first. **Stop if it isn't
   the throwaway project's URL.**

4. **Recreate the accounts** (dry run, then apply):

   ```bash
   npx tsx --env-file=.env.restore-test.local scripts/restore-auth-placeholders.ts --dir backups/<stamp>
   npx tsx --env-file=.env.restore-test.local scripts/restore-auth-placeholders.ts --dir backups/<stamp> --apply
   ```

   Write down "N account(s) in the backup". The script refuses a project
   that already has accounts, so pointing it at live by mistake stops here.

5. **Restore the rows** (dry run, then apply). The dry run prints each
   table's row count from the backup: keep that output, it's the "expected"
   column.

   ```bash
   npx tsx --env-file=.env.restore-test.local scripts/restore-db.ts --dir backups/<stamp>
   npx tsx --env-file=.env.restore-test.local scripts/restore-db.ts --dir backups/<stamp> --apply
   ```

6. **Restore the screenshots** (dry run, then apply):

   ```bash
   npx tsx --env-file=.env.restore-test.local scripts/restore-storage.ts --dir backups/<stamp>
   npx tsx --env-file=.env.restore-test.local scripts/restore-storage.ts --dir backups/<stamp> --apply
   ```

7. **Compare.** In the throwaway project's SQL editor:

   ```sql
   select 'accounts' as what, count(*) from auth.users
   union all select 'trades', count(*) from trades
   union all select 'trade_history', count(*) from trade_history
   union all select 'trade_images', count(*) from trade_images
   union all select 'field_definitions', count(*) from field_definitions
   union all select 'strategies', count(*) from strategies
   union all select 'ai_conversations', count(*) from ai_conversations
   union all select 'ai_messages', count(*) from ai_messages
   union all select 'ai_reviews', count(*) from ai_reviews
   union all select 'admin_audit_log', count(*) from admin_audit_log
   union all select 'screenshot files', count(*) from storage.objects where bucket_id = 'trade-images';
   ```

   - Each table's count must equal the dry run's count from step 5.
     `accounts` must equal step 4's number. `screenshot files` must equal
     the length of the `files` list in `backups/<stamp>/storage/trade-images.manifest.json`.
   - **Spot checks:**
     - every trade has an account: `select count(*) from trades t left join auth.users u on u.id = t.user_id where u.id is null;` must be 0;
     - every screenshot row has its file: `select count(*) from trade_images i left join storage.objects o on o.bucket_id = 'trade-images' and o.name = i.storage_path where o.id is null;` must be 0;
     - Storage → trade-images: open one screenshot and check it shows.
   - For scale, not exact equality, compare with live's counts on the
     admin pages: the backup is from the night before, so live will be a
     little ahead.

8. **Write down the end time** and fill in the log below.

9. **Clean up, all of it:**
   - delete the throwaway project (Settings → General → Delete project);
   - delete `.env.restore-test.local`, `backup.tar.gz`, the downloaded
     `.gpg`/`.zip`, and `backups/<stamp>/`. These are live users' data,
     unencrypted;
   - resume the dev project if you paused it.

## In a real restore, afterwards

- **Accounts deleted after the backup was taken must be deleted again**
  (the privacy page promises it). If the old project is still reachable,
  list them from its audit log:
  `select target, created_at from admin_audit_log where action = 'account_delete' and created_at > '<backup time>';`
  Then delete each id in the restored project. If the old project is gone,
  so is the log for that window; say so in the incident notes
  (`docs/postmortem-template.md`).
- Restoring into the **same** project (a bad migration, a mass delete) needs
  no step 4: the accounts still exist. Use `npm run restore:db` as
  `docs/runbook.md` §3 describes.

## Log

| Date | Backup stamp | Who | Took (min) | Accounts | Rows match? | Files match? | Spot checks | Problems found |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
