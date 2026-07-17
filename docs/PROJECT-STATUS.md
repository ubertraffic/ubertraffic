# SiteCall — Project Status

_Last updated: 18 July 2026_

Uber-for-construction-labour. React Native / Expo (tested on iPad via Expo Snack, so
**no native modules** — Stripe uses hosted Checkout, not the native SDK). Supabase backend
(Edge Functions, RLS, RPCs, Storage). Market: Sydney / NSW.

## Branch model
- **`claude/closeout-card-modal-layout-olfscn`** — working branch, all app `.js`.
- **`snack-preview`** — working branch stripped of `migrations/`, `edge-functions/`, and docs
  so Expo Snack's GitHub import doesn't fail on non-code assets. **This is what gets imported
  into Snack.** Rebuilt on every push.
- **`migrations`** — all `*.sql` + `edge-functions/*.ts` + `CLAUDE.md` + `PRODUCT-CONSTITUTION.md`
  + these docs. The system-of-record for anything that isn't app runtime.
- **`main`** — merged history.

## Database migrations (run by hand in Supabase SQL editor)
Applied through **0063**. Notable recent:
- 0060 payments · 0061 connect_payouts · 0062 travel_tip
- **0063 service_role grants** — the Edge Functions had lost table privileges on `public`
  (caused `permission denied for table requests`). This restores them.

## ✅ Completed

### Payments (Stripe, TEST MODE) — the big one
- Full flow: **authorise a hold when the job is posted → capture + pay the worker when the
  client approves.** Release on cancel.
- Edge Functions: `create-checkout`, `checkout-status`, `capture-payment`, `release-payment`,
  `connect-onboard`, `connect-status`. Secret key lives only server-side; amounts computed
  server-side from the job (client can't underpay).
- Worker payouts via Stripe Connect (Express accounts + Transfers).
- **Fee model (live everywhere): 10% of labour + $3 per task. Tips + travel are 100% to the
  worker.** All old "12%" copy removed; the model is shown transparently on the earnings and
  review screens.
- Fixes shipped this session:
  - 401 `not_authenticated` → attach the user's `Authorization: Bearer <token>` to every call.
  - "Nothing about Stripe" → payment was wired only into the Home map. Extracted a single
    `useClientPayFlow` hook and drove **every** client posting/approval surface through it.
  - `request_not_found` → root cause was missing `service_role` grants (0063); also hardened
    `create-checkout` to report the real DB error instead of masking it.
  - Pay sheet flashing **$0** right after posting → estimate now threaded from the post form.

### Product / UX
- Hire-side business details (company + ABN); worker ABN; ID-on-file (licence photo).
- Secure **admin panel** (no self-grant) — verification queues, credentials, user vehicles.
- Credentials: grant/remove (admin), evidence upload.
- DOB entry fixed to DD/MM/YYYY (UTC bug).
- Help centre reachable everywhere.
- Live tracker fixes; "arrived" works from the expanded map.
- Accept celebration ("it's a match" moment).
- Post **picker** redesigned (researched IA): featured + collapsed folders, tasks/runs first.
- "What I supply" / capabilities cluster; skill discovery from home.
- Public profile revamp; vehicles/equipment/insurance/registration for both sides, **linked
  to the job flow** (shows the real vehicle, not a hardcoded 'Ute').
- Prestart animation + visual "What's this?" cards; jobs tab readability.
- **This session's polish:** review-before-pay trimmed (removed verified-tickets + inline
  tip/travel); Requests filters condensed 7 → **3** (Active / Ready to pay / Past); post-form
  inputs now crisp white fields; Send no longer hidden by the keyboard; skill-discovery sheet
  no longer jumps as it loads; close-out sheet enters with the clean fixed-offset spring.

## 🐞 Known issues / open
1. **`submit_abn` drops the ABN digits** — sets `company_verify_status = pending` but leaves
   `company_abn` null. The number the user types isn't saved.
2. **Hire gate needs manual approval** — no auto-verify. For testing, `can_hire` is unlocked
   by SQL (or the admin Approve button). Test accounts currently unlocked via SQL.
3. **PR #24** (the core payment wiring fix) is **open, not merged**.
4. **Tip timing** — tips are collected at the post-time hold, not at approval. Tipping usually
   happens *after* the work; worth reconsidering the moment.
5. **Payment status is confirmed app-side** (`checkout-status`) — fine for Snack, but a signed
   Stripe **webhook** is the production-grade replacement.

## ▶️ Suggested next
**Short term**
- Fix the `submit_abn` ABN-save bug (+ optional: auto-verify a valid ABN in test mode via the
  `verify-abn` ABR lookup, so no manual unlock is ever needed).
- Merge PR #24.
- The "just posted" moment: drop into a focused **"Finding workers"** live screen for that job
  (Uber pattern) instead of landing in a list. Pieces already exist (FindingOperators / the
  home match card).

**Before real money / launch**
- Switch payment confirmation to a **signed Stripe webhook**.
- **Grants + RLS audit** — the fact that `service_role` had lost its grants (needing 0063)
  means the DB privilege state should be reviewed end-to-end.
- Real business verification (ABR) + terms for payments; consider "pay on completion" terms
  for verified/repeat clients, and save-a-card for booked jobs.
- Move Stripe out of TEST MODE only after the above.

**Engineering fundamentals** (flagged earlier, still open)
- Accept-lock tests, basic CI, error observability.
