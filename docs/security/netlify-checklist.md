# Netlify checklist

From the security gaps pass, item 4.4 ([02-gaps-report.md](02-gaps-report.md)).
The repo can't see the Netlify dashboard, so **nothing below is assumed
about its current state**. `netlify.toml` sets no deploy contexts, so every
setting here lives only in the dashboard.

**Why it matters:** the repo is **public**. If deploy previews are on and
the environment variables aren't scoped, a preview build (including one from
a stranger's pull request, depending on settings) runs with the **live**
Supabase service-role key, the AI-key encryption secret and the cron secret.
A preview that can reach the live database is a second production you can't
see.

## Deploys

- [ ] **Site configuration → Build & deploy → Continuous deployment → Branches
      and deploy contexts:** Production branch = `main`.
- [ ] **Branch deploys:** set to "None" (you don't use them).
- [ ] **Deploy previews:** turn them off ("Don't deploy pull requests"),
      unless you actively use them. If you keep them, do the next section
      first.
- [ ] **Deploy previews from forks / outside contributors:** off, or "require
      approval". On a public repo this is the one that matters most.
- [ ] **Build hooks:** delete any you don't recognise (anyone with a hook URL
      can trigger a build).

## Environment variables, scoped by deploy context

**Site configuration → Environment variables.** For each of these, open it
and set **Scopes/contexts** so the live value is used for **Production only**:

- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `AI_KEY_ENCRYPTION_SECRET` (and `AI_KEY_ENCRYPTION_SECRET_PREVIOUS` if set)
- [ ] `CRON_SECRET`
- [ ] `SENTRY_AUTH_TOKEN`
- [ ] `DEMO_ACCOUNT_PASSWORD`, if it's there at all (it shouldn't need to be)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: if
      previews stay on, give the **Deploy previews** context the **dev**
      project's values instead, so a preview can never touch live data.

## Install command and Node

- [ ] **Build settings → Build command:** check what it runs. It should
      install with `npm ci` (exactly the lockfile), not `npm install`.
- [ ] **Node version:** confirm it follows `.nvmrc` (24).

## Who can build and change settings

- [ ] **Team → Members:** only you.
- [ ] **Your user → Security:** two-factor authentication on (also in
      [account-checklist.md](account-checklist.md)).
- [ ] **Site configuration → General → Danger zone / access:** no other team
      or collaborator has access.

## Logs

- [ ] **Functions logs** are private to the team, which is fine. The
      auto-execute cron writes its summary there (tickers, counts), so keep
      the team to you.

When it's done, tell Claude what you changed, and item 4.4 in the report
becomes "verified on <date>".
