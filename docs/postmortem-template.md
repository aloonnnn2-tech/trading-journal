# Postmortem: <short title>

Blameless: this is about how the system let it happen, not who did what. Copy this file to
`docs/postmortems/YYYY-MM-DD-<slug>.md` and fill it in within a few days, while it's fresh.

- **Date / duration:** <when it started> → <when it was resolved> (<how long>)
- **Written by:** <name>
- **Severity:** <who was affected, how badly: e.g. "all users couldn't sign in", "charts empty for 20 minutes">

## Summary

Two or three sentences a user could read: what broke, for whom, for how long, and that it's fixed.

## Timeline

Times in UTC. Facts only.

| Time | What happened |
|---|---|
| | First sign of trouble (an alert? a user message? Sentry?) |
| | Noticed by |
| | What was tried |
| | Fixed by |

## Cause

What actually went wrong, down to the root. Ask "why?" until the answer is something that can be changed.
Link the commit, the Sentry issue, the log lines (`requestId` helps).

## What went well

What made it shorter or smaller than it could have been.

## What went badly

What made it longer or bigger: a missing alert, a confusing message, a step that wasn't written down.

## Follow-up actions

Each one specific, small enough to do, with a place it is tracked.

| Action | Why it helps | Done? |
|---|---|---|
| | | |

## Was data lost or exposed?

Yes / no. If yes: whose, what, and whether anyone has to be told.
