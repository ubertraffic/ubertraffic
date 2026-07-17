# CLAUDE.md — SiteCall

Engineering rules for this project. Read this at the start of every session and align all
suggestions with it from the beginning — don't wait to be corrected later.

**Mental model:** You (Claude Code) are a brilliant, fast junior developer. You write code faster
than anyone — but like any junior, you need guidance on architecture, security, and long-term
maintainability, and you will miss things (especially security and edge cases) unless we're
deliberate. The senior engineer is the human. When something is ambiguous, ask. When something
smells hacky, say so rather than shipping it.

---

## 0. Root cause — the overriding rule

No quick fixes. Diagnose to the **root cause** and devise a proper solution. Never apply a patch,
workaround, or band-aid unless the human explicitly asks for one. If a proper fix is large, say so
and propose the real path rather than papering over the symptom. "It compiles and the feature works"
is not the bar — correctness, security, and maintainability are.

---

## 1. Security & secrets

- **Never hardcode secrets. Never commit them to git.** Use environment variables / a secrets manager.
- Keep **separate credentials for dev, staging, and prod** — different API tokens per environment,
  never the same one copy-pasted around.
- **Validate ALL input server-side.** Never trust what the client sends. Assume the happy path is a
  lie and that bad actors will send malformed, hostile, or out-of-range data.
- **Rate-limit auth and write operations** from the start, not after an incident.

### SiteCall specifics
- Crown-jewel secrets: **Stripe secret key**, **Supabase service-role key**, **SafeWork verification
  API credentials**. These must never appear in the client bundle (Expo app), in logs, or in git.
  A leaked Stripe secret on a payments app is a catastrophe, not a bug.
- The Expo/React Native client may only ever hold **publishable / anon** keys. All privileged
  operations go through server-side (Supabase Edge Functions / RPC) where the service-role key lives.
- Row-Level Security (RLS) on by default: clients see only their own requests; operators see only
  dispatches addressed to them. Write RLS policies **before** exposing any table to the client.

---

## 2. Architecture & code quality

- **Design the architecture before building.** Don't let it emerge from spaghetti.
- Break up large components / view controllers **early**. No single file owning a whole screen.
- **Wrap every external API in a clean service layer** (Stripe, Supabase, SafeWork, maps, SMS/OTP).
  This is where caching, retries, provider-swapping, and **rate limiting** live — not scattered
  through the UI.
- **Version all database schema changes through proper migrations.** Never mutate the schema by hand
  and track it in your head. Every change is a migration file, checked into git, applied in order.
- Use **real feature flags**, not commenting code in and out.

### SiteCall specifics
- The **atomic accept-lock is the heart of the system** and must be provably correct before anything
  is built on top of it. Claiming a job spot is a single atomic server-side statement guarded by the
  item quantity — never read-then-write from the client. It lives in a Postgres function / RPC with a
  row lock on `request_items`; realtime pushes fills to all devices. Two operators must never be
  promised the same spot. Treat this as security-critical code: server-side, validated, tested hard.
- Keep the data model as specified: `profiles`, `operator_credentials`, `operator_capabilities`,
  `requests`, `request_items` (multi-item: gear + crew + community tasks in one request),
  `dispatches`, `assignments` (one row per filled spot, quantity-aware).

---

## 3. Observability

- **Crash reporting from day one** (e.g. Sentry) — not after the first angry review.
- **Persistent logging** that lives somewhere queryable — not just terminal history.
- A **`/health` endpoint for every service** so liveness can be checked without hitting the homepage
  and hoping.

### SiteCall specifics
- Log the lifecycle of every request and dispatch (created → alerted → accepted → completed → paid)
  with correlation IDs, so a stuck or double-filled job can be traced end to end. Never log secrets
  or full PII.

---

## 4. Environments & deployment

- Maintain a **real staging environment that mirrors production** — not just "dev" and "prod-ish".
- **CORS set to specific origins, never `*`.**
- **Set up CI/CD early.** CI = automatic testing, CD = automatic deploying. Deploys come **from the
  pipeline, not from a laptop** with a random script. "I ran it locally and it worked" is not a
  deployment strategy.
- **Document how to run, build, and deploy** the project. If only one person knows how to deploy,
  that's a problem waiting to happen.

### SiteCall specifics
- Separate Supabase projects (or clearly separated schemas) and separate Stripe accounts/keys for
  dev / staging / prod. Test payments only ever run against Stripe **test mode** in dev/staging.

---

## 5. Testing & resilience

- **Test the unhappy paths**, deliberately: network failure, unexpected/malformed API responses,
  timeouts, empty results, hostile input. AI-generated code handles the sunny day beautifully; the
  edge cases need intentional attention.
- **Test a backup restore at least once** — don't let the first restore attempt be during a real
  emergency.

### SiteCall specifics — the unhappy path *is* the product
Emergency dispatch lives or dies on edge cases. Explicitly design and test:
- No operator accepts within the window → wave widens → human fallback.
- Two operators accept the last spot simultaneously → exactly one wins (the accept-lock).
- Payment authorises but the job is cancelled → hold released cleanly.
- Client ghosts the completion approval → auto-approve on logged hours so the worker is paid.
- Operator's phone dies mid-shift / loses signal → geofence + docket still reconcile.
- A credential expires between accept and shift → operator paused, job re-dispatched.

---

## 6. Time handling

- **Store all timestamps in UTC.** Convert to local time **only on display.**
- Never mix UTC, local, and whatever the runtime defaulted to — it's a debugging nightmare.

### SiteCall specifics
- Shift check-in/out, dispatch windows, payout schedules, and scheduled ("book ahead") jobs all store
  UTC and render in the user's local zone. Australia spans multiple timezones — don't assume AEST.

---

## 7. Discipline

- If something feels hacky, **fix it now or create a tracked ticket with a real deadline.** "Later"
  never comes.
- **Don't skip fundamentals just because the code compiles and runs.** The cost of skipping them is
  hidden by how fast everything else moves — which is exactly why they matter more here, not less.

---

## Delivery preferences (this developer)

- Non-coder senior owner working on iPad; code is pasted into Expo Snack. Claude owns all code.
- Prefer clear, complete, paste-ready output with a short explanation of what changed and why.
- Call out anything security-sensitive or hacky explicitly rather than burying it.
- Prevention beats cleanup — every time.
