# SiteCall — Full App Audit

_A complete, plain-English + technical reference of what the app is, what exists, and how every
part works. Covers the project from day one through today._

**Last updated:** 19 July 2026

---

## 1. What SiteCall is

SiteCall is **Uber for construction labour** — a two-sided marketplace for Sydney / NSW that
connects **clients** (builders, site managers — the "Hire" side) with **workers** (traffic
controllers, labourers, trades, plant operators, delivery/errand runners — the "Work" side).

A client posts what they need on site; nearby workers are notified instantly, one accepts, travels
to site, does the job, and gets paid the moment the client approves the work — with money held
securely on the client's card the whole time.

### The stack

| Layer | Technology |
|---|---|
| App | React Native via **Expo**, tested on iPad through **Expo Go / Snack** — so **no native modules** |
| Map | **MapLibre GL JS** inside a **WebView** (MapTiler dark tiles) — avoids a native map SDK |
| Backend | **Supabase** — Postgres with Row-Level Security (RLS), SECURITY-DEFINER RPCs, Storage, Edge Functions (Deno) |
| Payments | **Stripe** — hosted Checkout + manual capture + Connect Express transfers (currently **TEST MODE**) |
| Maps/geo | **Nominatim** (OpenStreetMap) for address↔coordinates |

Because the app must run in Expo Go, several choices follow directly: Stripe uses **hosted Checkout**
(not the native SDK), the map is a **WebView**, and push notifications are **scaffolded but dormant**
(they need a native/EAS build to fire).

### Core architectural principles

1. **The service layer is the only door to the database.** Screens never call Supabase directly —
   every read/write goes through a `*Service.js` module. This keeps security and query logic in one
   place per domain.
2. **The server is the source of truth for anything sensitive.** Money amounts, the accept-lock,
   geofencing, settlement, verification, and admin powers are all enforced in Postgres RPCs / Edge
   Functions. The app is the data + UI layer; it cannot be tricked into underpaying, self-verifying,
   or self-granting admin.
3. **Capabilities are granted, never claimed.** A client can't self-verify their business; a worker
   can't self-verify a ticket. Verification lands "pending/review" and only a real check (ABR
   register, an admin, or a licensing API) flips it to "verified".
4. **Honesty in the UI.** Ratings distinguish "new" from "experienced but unrated"; a stalled job
   search says so; a failed payout shows the truth rather than reading "paid".

---

## 2. Branch model & how it's deployed

| Branch | Purpose |
|---|---|
| `claude/closeout-card-modal-layout-olfscn` | **Working branch.** All app `.js` + migrations + edge functions + docs. |
| `snack-preview` | The working branch **stripped** of `migrations/`, `edge-functions/`, and docs, so Expo Snack's GitHub import doesn't choke on non-code files. **This is what gets imported into Snack.** Rebuilt on every push. |
| `main` | Merged history. |

- **Migrations are run by hand** in the Supabase SQL editor, in order.
- **Edge Functions are deployed by hand** from the Supabase dashboard (paste the `.ts` file).
- The Stripe secret key lives **only** in Edge Function secrets (`STRIPE_SECRET_KEY`), never in the app.

---

## 3. The app shell (`App.js`, `TabBar.js`, `RoleToggle.js`)

### Boot & auth
`App()` checks `supabase.auth.getSession()` on mount; a session renders `<Shell>`, otherwise
`<Login>`. An `onAuthStateChange` listener keeps the session live across sign-in/out/refresh.
`Login` has explicit sign-in / sign-up modes (never guessed), with signup paced into two steps and
honest handling of "already registered" / "email not confirmed".

### Roles & the two sides
A single account can be **both** a client and a worker. `Shell` tracks a `role` view
(`'client' | 'operator'`) and derives gates from the profile:
- `canHire` — the business ABN is verified (`company_verify_status`).
- `canWork` — the worker can do site work or task/driving work (`can_work || can_task`).

**`RoleToggle`** is the Hire↔Work switch: a spring-animated thumb slides and recolours **indigo
(Hire) ⇄ green (Work)**. Tapping a locked side opens the **`CapabilityGate`** — the verification
modal (Hire → submit business ABN against the ABR; Work → submit a White Card / driver's licence).
Submitting lands "under review"; approval is server-side.

### Tabs
- **Client:** `Home · Requests · Activity · Account`
- **Worker:** `Home · Jobs · Earnings · Account`

`TabBar` is a floating dark "island" pill; the active tab is tinted with the side's accent colour.

### The persistent map + cross-fade overlays
The Home map is a **permanent base layer mounted once**. Both `ClientHome` and `OperatorHome` stay
mounted at all times (toggled by visibility), so **the map never reloads** when you switch Hire↔Work
or leave and return Home. Non-home tabs render as opaque canvas-coloured **overlays** that cross-fade
and slide in over the map. This is what makes navigation feel seamless.

---

## 4. Client (Hire) side — how it works

### The immersive Hire home (`ClientHome`)
A full-bleed map behind a floating sheet. The client sees:
- A pinned **"Who do you need on site?"** post card (the `＋` opens the post flow).
- A translucent **"?"** help button on the map (opens the Help Centre).
- Their **own active jobs** — a live tracker, a "match" card once a worker's on it, and any jobs
  that need their attention — rather than strangers' activity.

When there's no active work the sheet hugs its content above the tab bar; when there is, it rises
into a scrollable panel showing live trackers and active jobs.

### Posting a job (`RequestSheet` — the wizard)
A phased wizard: **what → rate → where → when → review → sent**, with a progress bar and
assembled-answer chips.
1. **What** — pick a trade from a searchable picker: a POPULAR row plus four collapsed folders
   (Tasks & runs · Traffic & labour · Skilled trades · Equipment & plant), driven by the trade
   taxonomy (`trade_categories` → `trades`).
2. **Rate** — a `$` and quantity stepper (rate pre-fills from sensible defaults). "Add another"
   loops back to add more roles to the same job.
3. **Where** — "Use my current location" (reverse-geocoded) or address autocomplete. **Real
   coordinates are required** (a free-typed address with no map pin is blocked) so the worker
   geofence works.
4. **When** — "Now — urgent" vs "Book ahead" (day + hour chips).
5. **Review** — summary plus optional fields: job details/duties (the description workers read
   before accepting), site contact, "where to buy" (for runs), a materials budget, and a travel
   allowance (100% to the worker).

Each job becomes a **`requests`** row plus one or more **`request_items`** (each with a trade, qty,
rate, and `price_mode`: `hour` for hourly labour or `job` for a fixed-price task). Creation is a
two-step insert (`createRequest`) with best-effort rollback. There's also a **map-native post sheet**
(`MapPostSheet`) that rises inside the map's full-screen command centre and shares the same creation
logic.

### After posting — finding a crew
From the Requests tab, posting drops into **`SearchingScreen`** — a calm "finding your crew" moment
with a breathing halo and a real progress ring (notified → needed → filled), driven by realtime. It
honestly handles a stall after 45s ("Still looking…", or "No workers available yet" when there's no
coverage) rather than spinning forever.

### The requests list & filters (`ClientRequests`)
The seven internal status buckets collapse into **three** client-facing filters: **Active · Ready to
pay · Past**. Each job card (`FullReqCard`) shows spot progress and offers Review & pay, Cancel, and
Re-post.

### Live tracking (`LiveTrackerCard`, `TrackerContainer`)
The in-app "Live Activity" surface. The client watches the journey — **Finding a worker → Booked →
On the way → On site → Complete** — as a confidence ring that changes colour and pulse per stage
(amber while finding, indigo en route, green on site). Tapping expands to a full-screen view with the
worker's trust block (rating, jobs done, vehicle, verified credentials — shown **only when real**),
a live ETA, the crew roster for multi-worker jobs, and actions (review, message, view profile). When
a search stalls, the animation stops — honesty over false motion.

### Approving & the receipt
Approval goes through **`ReviewApprove`** — a review-before-pay sheet showing the whole crew, hours,
the 10%-of-labour fee, materials, a safety record per worker, and the amount breakdown. Approve is
**blocked** while any crew member is incomplete or a materials claim is unresolved. After payment,
the **`ActivityCard`** (in the Activity tab) is an expandable **receipt**: job total, platform fee,
"paid to worker", completed date, site, the **paid date + a `SC-XXXXXXXX` receipt number** from the
Stripe payment, and a "paid securely via Stripe" note.

---

## 5. Worker (Work) side — how it works

### Becoming a worker
If the account isn't yet an operator, the Work home shows an identity-capture form (full legal name
+ DOB). Submitting writes the identity (the anchor for future register checks, never shown publicly),
sets the role, seeds a first capability, and sets a default vehicle.

### "What I supply" (capabilities)
A worker lists what they can do (`operator_capabilities`) via the trade picker. Each capability shows
a **readiness pill** — "Ready ✓" or "Tickets needed" — computed by mirroring the server's accept-gate:
for a trade's required credentials, does the worker hold them **verified and unexpired**? When online
with nothing ready, an amber "add your tickets" nudge appears.

### Going online — the GO orb & the payout gate
The Work home is immersive: a full-bleed map under a green sheet whose top control is the
**`GoOnlineOrb`** — a breathing green orb with **press-and-hold to confirm** (a ring charges with
haptics; lifting early cancels, so a stray tap never puts you online).

**The payout gate (this is a money-safety guard):** `goLive()` calls `ensurePayoutReady()` **before**
anything else. If the worker's Stripe payout account isn't ready, it opens the **`PayoutGateSheet`**
(Stripe onboarding) and **blocks going online** — it **fails closed** (an unknown status blocks).
The same gate guards **accepting** a job. This is what makes it impossible for a worker to do a job
and then have the client's money captured with nowhere to send it.

Going online also **requires location** (dispatch is geographic): if GPS is denied it rolls back and
asks the worker to enable location. When online, the orb becomes a status pill with a live earnings
ticker and a counting shift timer. Going offline needs a deliberate **slide-to-confirm** on the
**`EndShiftSheet`** ("Nice work today" — earned / jobs / minutes).

### The job feed & accepting
Nearby work (`listMyDispatches`) is shown as **`AvailableJobCard`s** (`WorkFeed`): urgency, trade +
suburb, expandable job details, pay ("$X/hr" or "$X/job", with an estimated total), open-spot pips,
and a big green **Accept**. Accept re-checks the payout gate, then calls `acceptSpot` (an atomic
server accept-lock so two workers can't take the same spot), fires the "it's a match" celebration,
and refreshes. **Pass** is soft and session-local — the job stays live for others.

### The job lifecycle (state machine)
Every transition is a server RPC (the app just calls it):

**committed → en_route → on_site → complete → approved**

- **Start journey** (`start_journey`) — passes real GPS so the server computes an honest ETA.
- **Arrive / check-in** (`check_in`) — **geofenced**: the server hard-blocks a check-in more than
  **300 m** from site. If GPS says you're too far, the app offers a "Confirm you're on site" override
  (logged as `gps_override`).
- **Prestart safety gate** (`PrestartCard`) — for trades that require it, four reg-291 hazard
  questions; any "Yes" reveals a mandatory SWMS acknowledgment before the job is workable.
- **Complete / check-out** (`check_out`) — GPS is best-effort here (indoors/no signal is routine);
  the worker is never blocked from finishing and getting paid.
- **Close-out gate** (`CloseOutCard` / `RunCloseOutCard`) — completion is gated by `compliance_ready`:
  the card shows exactly what's missing (completion photo, prestart, sign-off) and only enables
  "Complete job" when the server says it's satisfied. Sign-off must match the worker's legal name.

**Runs vs tasks vs hourly:** a "run" (errand/delivery, `run_style` trade) uses a `RunBrief` (what to
buy, where, spend cap, drop-off) and a `RunCloseOutCard` (drop-off photo + receipt via the
materials-claim rail). Tasks are fixed-price (`price_mode='job'`); everything else is hourly.

**Recovery paths:** a worker who couldn't cleanly check out ("phone died") uses **missed-checkout**
→ reconciliation (hours confirmed by the client/site contact, or auto-confirmed on a deadline). A
worker who committed but never showed is surfaced client-side as a **stall** → the client can
**release & re-post**. Post-completion, an auto-release countdown protects the worker if the client
goes quiet.

Both the map (in-map lifecycle) and the **Jobs tab** (`OperatorJobs`, a list of cards) drive the
**same** service calls. While en route, the worker's live GPS pings every 15s for the client's ETA.

### Job chat (`JobChat`)
A contextual chat sheet that rises over the current screen (no navigation). Durable messages
(`send_job_message`, server-validated), realtime delivery with an 8s poll fallback, "Seen" receipts,
and a job-context header. Opened from map pins, the tracker, the run brief, and the Jobs tab.

### Earnings & payouts (`OperatorEarnings`, `PayoutsScreen`)
- **Earnings** shows "Paid to you" (net after fees), pending approval, and a job history. It reads
  the **real `payouts` ledger** so each job carries a true status pill — **Paid / Processing /
  Payout failed** — and a banner + fix path if a transfer didn't land (rather than everything
  reading "paid").
- **Payouts** is Stripe Connect Express onboarding: reads live status (`connect-status`), opens
  Stripe's hosted onboarding (`connect-onboard`), re-checks on return. Bank details are entered on
  Stripe's page — SiteCall never sees them.

---

## 6. The money system (Stripe) — the heart of the app

This is the most safety-critical subsystem. The model is **authorize a hold → capture on approval →
transfer to the worker**, with the client's card held (not charged) until the work is done.

### The flow
1. **Checkout / hold** — once a worker is on the job, `create-checkout` computes the amount
   **server-side** from the request (the client only sends a `request_id`, never a price, so they
   can't underpay), creates a Stripe Checkout Session with **manual capture** (authorize now, capture
   later), and records a `payments` row. A **dedup guard** prevents a second hold on the same job.
2. **Confirm** — the app opens Stripe's hosted page; on return, an AppState listener auto-confirms via
   `checkout-status`. No manual "I've paid" tap.
3. **Approve → settle → capture → pay** — when the client approves:
   - **Settle first:** the app calls `approve_request` → `_settle_request`, which computes **exactly
     what each worker is owed** (`net_amount`, including any approved extra hours, at the correct
     fee) and marks the assignment approved.
   - **Then capture:** `capture-payment` captures the held funds and **transfers each worker their
     settled `net_amount`** via a Stripe Connect transfer. It pays the DB-settled figure, not a
     recomputed guess — so what the worker was shown is what lands.
4. **Cancel → release** — cancelling a job (only possible before settlement) voids the hold via
   `release-payment`; the authorization drops off the client's card. The client is told "you haven't
   been charged, and any card hold has been released."

### The fee model (live everywhere)
- **Labour (hourly):** SiteCall keeps **10%**; the worker keeps 90%.
- **Tasks (fixed-price):** worker keeps **100%**; a flat **$3 booking fee** is added at checkout.
- **Tips & travel:** **100%** to the worker.

The same math lives in `create-checkout` (what the client pays) and `_settle_request` (what the
worker is paid), kept in sync.

### Safety properties (built this cycle)
- **Never pay before a worker completes** — both the app (guards) and `capture-payment` (a safety
  gate that refuses to capture with no completed worker) enforce this. _(Fixes the original "it paid
  before anyone accepted" bug.)_
- **Payout gate** — a worker can't go online / accept without a ready Stripe payout account, so money
  can never be captured with nowhere to send it.
- **Idempotent** — capture and every transfer carry a Stripe Idempotency-Key, so a retry or
  double-tap can never double-charge or double-pay.
- **Resumable** — if payouts fail mid-way, re-invoking `capture-payment` pays only the workers not
  yet paid (it doesn't re-capture).
- **Honest** — if any payout fails, the function reports it (`all_paid:false`) instead of claiming
  success.
- **Signed webhook** — `stripe-webhook` is the server-to-server source of truth for payment status
  (HMAC-SHA256 verified), so status is recorded even if the client closes the app.
- **One verified ABN per account** — a partial unique index blocks two accounts both verifying the
  same business number.

### Edge Functions (Deno, deployed by hand)
| Function | Role |
|---|---|
| `create-checkout` | Build the Stripe Checkout Session (server-computed amount, manual capture, dedup guard) |
| `checkout-status` | Confirm payment state after the client returns from Stripe |
| `capture-payment` | Capture the hold + transfer each worker their settled net (idempotent, resumable, honest) |
| `release-payment` | Void a hold on cancel (handles pending & authorized holds) |
| `connect-onboard` / `connect-status` | Worker Stripe Connect Express onboarding + status |
| `stripe-webhook` | Signed source-of-truth for payment status (deploy with **Verify JWT OFF**) |
| `verify-abn` | Verify a business ABN against the ABR register (strong name match) |
| `verify-credential` | Verify a worker credential — **deployed server-side, source not in this repo** |

---

## 7. Cross-cutting systems

### Ratings & reputation
Two-way ratings (client rates worker, worker rates client) via `RateJob` — 1–5 stars, an optional
comment, and (when rating a worker) "good unit" tags + an "I'd have them back" flag. Direction is
inferred server-side. Aggregates come from `get_reputation_extras` (worker: re-hire count, tag
tallies, peer-vouch count) and `get_client_reputation` (client's "from workers" score). **Peer
vouches** (`VouchCrewCard`) let crew who worked a shared job vouch for each other — server-verified
so it can't be gamed. Reputation shows on **`PublicProfile`**, which honestly distinguishes "new"
from "experienced but unrated".

### Credentials & compliance
A worker becomes "ready" for a trade by holding its **required** credentials, **verified and current**
(`readinessForTrades` mirrors the server gate). Credentials with a free register API auto-verify
(`verify-credential`); the rest (White Card, licences, insurance) take a **photo-evidence** path into
a **private, owner-only** storage bucket and land **"review"** — never self-verified. An admin flips
them to verified. On site, the **prestart/SWMS** flow and **photo proof + sign-off** are captured as
append-only `job_events`, surfaced later as a **safety record**.

### Identity, business & ABN verification
- **Identity** — legal name + DOB (sensitive PII, never shown), the anchor for register checks.
- **Business** — company name + ABN; verification via `verify-abn` (checks the ABN is **active** AND
  a **strong name match** to the register before flipping to verified — this closed the "any ABN
  verified on a second account" hole).
- **Hire gate** — `can_hire` unlocks the client side; admin/ABR approval sets it. One verified ABN
  per account (migration 0065).

### Admin
`AdminScreen` (reviews · ABNs · users · ops) is convenience-gated in-app by `amIAdmin()`, but the
**real** gate is server-side: `is_admin()` reads an `admins` table with **no client write path**
(self-grant is structurally impossible). **Every** admin RPC re-checks `is_admin()`. Queues cover
pending credentials, pending ABNs, user search, active jobs, and per-user credentials/vehicles.

### Other systems
- **Realtime** — `useRealtime(tables, onChange)` subscribes to Postgres changes and debounces bursts
  into a single refresh. This is how the app feels live today (not push).
- **Push** — `pushService` is fully scaffolded but **dormant in Expo Go** (native modules are
  soft-required, so calls no-op); it comes alive on an EAS build. **Server infra (token table +
  send function) is not yet built** — deferred.
- **Chat** — durable job-room messaging with realtime + read receipts.
- **Beats / MomentToast** — warm "here's what just happened" toasts from real jobs.
- **Pulse** — an anonymised network-activity feed + headline stats (jobs today, paid today, active
  now), names stripped server-side.
- **Error logging** — `errorService` funnels errors into an `error_log` table (a pre-Sentry crash
  substitute): fire-and-forget, PII-redacting, rate-limited.
- **Geocoding / location** — Nominatim for address↔coords; device GPS with an **honest fallback**
  flag so the geofence is testable without faking a pass.
- **The map** — a WebView MapLibre dark map built **once** and fed live state via diffed updates, so
  a job's lifecycle plays as one continuous frame. Includes an animated **Sydney-wide surge/heat
  map** (red demand / green supply) that flows continuously when idle.

---

## 8. Data model (migrations 0046 → 0066)

> Migrations **before 0046 predate this repo** — the base schema (`profiles`, `requests`,
> `request_items`, `assignments`, `dispatches`, `ratings`, `operator_capabilities`,
> `operator_credentials`, `credential_types`, `trades`/`trade_categories`/`trade_requirements`,
> `job_events`, `job_messages`, `material_claims`, `rate_card`, and the core settlement / accept-lock
> / geofence RPCs) already exists and is only referenced by 0046+.

| # | Migration | What it adds |
|---|---|---|
| 0046 | workers_with_skill | `workers_with_skill()` — "others who do this skill" (verified workers only) |
| 0047 | rating_extras | `ratings.tags` + `would_rehire`; `set_rating_extras`, `get_reputation_extras` |
| 0048 | peer_vouches | `peer_vouches` table + `coworkers_on_job` / `vouch_for_peer`; extends reputation with vouches |
| 0049 | requests_pickup_text | `requests.pickup_text` (runs: "where to buy") |
| 0050 | profiles_abn | worker `abn` + `abn_status` (format-valid, not register-verified) |
| 0051 | credentials_insurance_licences | credential `provider`; insurance/licence credential types |
| 0052 | job_proof_storage_lockdown | locks `job-proof` bucket to a job's two parties |
| 0053 | credential_fields | `expiry_rule`, `requires_card_no`, `card_number` |
| 0054 | profiles_identity | `legal_name`, `date_of_birth` (identity anchor, PII) |
| 0055 | profiles_company | `company_name`, `company_abn` (hire side) |
| 0056 | credential_evidence_bucket | **private** `credential-evidence` bucket (photo ID), owner-only |
| 0057 | admin_panel | `admins` table + `is_admin()` + all admin RPCs (self-grant impossible) |
| 0058 | operator_vehicles | `operator_vehicles` (rego + insurance + expiries), owner-only |
| 0059 | admin_user_vehicles | admin-gated `admin_user_vehicles()` |
| 0060 | payments | `payments` table (client-readable, service-role write) |
| 0061 | connect_payouts | `profiles.stripe_account_id`; `payouts` table (worker-readable) |
| 0062 | travel_tip | `requests.travel_cents`; `payments.tip_cents` / `travel_cents` |
| 0063 | service_role_grants | restores service_role GRANTs (fixed "permission denied for table requests") |
| 0064 | fee_10pct_labour | the 10%-labour / 0%-task fee model across all three settlement functions |
| **0065** | **abn_unique** | **one verified ABN per account** (partial unique indexes) — _this cycle_ |
| **0066** | **client_reputation** | **`get_client_reputation()`** — a client's rating from workers — _this cycle_ |

**Key tables (main columns):**
- **requests** — client, status, when_type, address + lat/lng, duration_hours, scheduled_at, site
  contact, materials_cap, travel_cents, job_details, pickup_text, settle_total/fee/net, settled_at,
  adj_extra_hours/travel/tip/bonus, review_deadline.
- **request_items** — request, kind (crew/task/gear), type, trade_id, qty, rate, price_mode
  (hour/job), hire (wet/dry), tickets[].
- **assignments** — request_item, operator, status, accepted_at, journey/ETA fields, paid_at,
  completed_at, gross/fee/net_amount, reconcile_state/deadline.
- **payments** — request, client, amount_cents, tip_cents, travel_cents, status, stripe_session_id,
  stripe_payment_intent.
- **payouts** — request, assignment, operator, amount_cents, status (paid/failed/pending),
  stripe_transfer_id, detail.
- **profiles** — role/account_type, is_online, names, legal_name, DOB, rating/rating_count, can_work/
  can_task/can_hire, verify statuses, abn/company_abn, stripe_account_id, headline/bio.
- **ratings** — assignment, rater_id, score, comment, direction, tags[], would_rehire.
- **operator_credentials** / **credential_types** / **operator_vehicles** — as above.

---

## 9. Services layer (one line each)

| Service | Owns |
|---|---|
| `accountService` | Identity, capabilities, ABN, business details, public profile + reputation reads |
| `adminService` | Wrappers over the admin-gated RPCs |
| `beatsService` | Lifecycle "beats" for moment toasts (real jobs only) |
| `communityService` | Skill discovery, coworkers-on-job, peer vouches |
| `completionService` | Shift lifecycle + settlement (journey, check-in/out, approve, cancel, reconciliation, trackers) |
| `complianceService` | Prestart/SWMS, photo proof, sign-off, safety record |
| `credentialsService` | Credentials: list/add/verify/evidence, trade readiness |
| `errorService` | Error logging into `error_log` (PII-redacting, rate-limited) |
| `geocodeService` | Address↔coords via Nominatim |
| `messagesService` | Job-room chat |
| `operatorService` | Operator data: role, online, location, capabilities, dispatches, accept, assignments |
| `paymentsService` | The only door to payments; invokes Edge Functions with the user's token |
| `pulseService` | Anonymised network activity feed + headline stats |
| `pushService` | Expo push registration (dormant in Expo Go) |
| `ratingsService` | Rating RPC wrappers |
| `requestsService` | Request creation/read (client) |
| `taxonomyService` | Trade taxonomy + client-side search/grouping |
| `vehiclesService` | A user's vehicles ("the rig") |

---

## 10. History — what's been built, from day one

### Foundation (pre-this-repo → mid-July)
The core marketplace: accounts + the two-sided role model, the trade taxonomy and posting flow, the
dispatch/accept-lock, the full job lifecycle with geofenced check-in and compliance/prestart gates,
job chat, two-way ratings + peer vouches, credentials + evidence, identity + business/ABN capture,
vehicles, the secure admin panel, the immersive WebView map, and the pulse/beats "alive" surfaces.

### Payments landed (the big one, through ~18 July)
The full Stripe flow — authorize a hold, capture on approval, transfer to the worker via Connect,
release on cancel — with server-computed amounts, the 6 core Edge Functions, and the **10%-labour /
0%-task** fee model live everywhere. Fixes: the `not_authenticated` token attach, extracting a single
`useClientPayFlow` so **every** client surface pays identically, the `service_role` grants (0063),
and the estimate-threading fix so the pay sheet stops flashing $0.

### This cycle (18–19 July) — polish, then money hardening & Tier 2
**Immersive redesign & feel:** the Hire home rebuilt around the client's own jobs (post-again, live
tracker) with a flush Sydney-wide surge heat map, static tab bar, dark chrome, and cross-fading tab
transitions; a world-class **Work** home with the hold-to-confirm **GO orb**, **EndShiftSheet**
slide-to-confirm, and **RoleToggle**; detail screens restyled; emoji swapped for real icons; keyboard
handling fixed across all forms.

**The critical money bug fixed:** posting no longer prompts payment before a worker accepts, and both
the app and `capture-payment` now refuse to move money with no completed worker.

**Money go-live hardening:** signed **`stripe-webhook`**; **idempotent + resumable** capture;
**dedup** on checkout; release handles pending holds; **strong ABN name-match** + **one-verified-ABN**
(0065).

**Payout gate:** a worker can't go online or accept until their bank is connected — closing the
"client charged, worker unpaid" hole at the source.

**Pay exactly what was promised (F9):** settle **before** capture, and transfer the DB-settled
`net_amount` — so extra hours and the correct fee are always honoured.

**Tier 2:** the phantom "rate the?" prompt fixed; **receipts & history** now surface the real Stripe
`payments`/`payouts` ledgers (true payout status per job, a real client receipt); **cancellation**
money-reassurance; and a **client's reputation** (from workers) now shows on their profile (0066).

---

## 11. Known gaps & what's next

### Deferred by decision
- **Staggered-crew pay-as-you-finish** — paying each worker the instant they finish, on a multi-worker
  job where workers complete at different times, requires **one Stripe hold per worker** (a
  hold/capture/release rebuild) and can only be verified against a live Stripe test account. Deferred
  as a focused next project. **Single-worker jobs are fully correct today** (the overwhelming
  majority).
- **Push notifications** — client scaffolding is ready but dormant in Expo Go; the server infra
  (token table + send function) and an EAS build are still needed. Deferred.

### Smaller open items
- **Bonus / approval-time materials in the transfer** — extra hours and the base are paid exactly;
  a client-added bonus or an approval-time materials claim isn't yet folded into the Stripe transfer
  (they're recorded at request level). Rare; a documented follow-up.
- **`submit_abn` ABN-save** — historically dropped the typed digits; superseded by the real
  `verify-abn` path, worth confirming end-to-end.
- **`verify-credential`** is deployed server-side but its source isn't in this repo — worth
  committing for completeness.

### Before real money / launch
- Redeploy the updated Edge Functions and run migrations **0065** + **0066**.
- Set up the Stripe **webhook endpoint** (+ `STRIPE_WEBHOOK_SECRET`, Verify JWT OFF).
- Run one full job **end-to-end in Stripe test mode** and confirm the worker's transfer amount in the
  Stripe dashboard matches what their app showed.
- A full **grants + RLS audit** (the fact that service_role once lost its grants means the privilege
  state deserves an end-to-end review).
- Move Stripe out of **TEST MODE** only after the above.

### Engineering fundamentals (still open)
- Accept-lock tests, basic CI, error observability beyond `error_log`.

---

## 12. Deployment checklist (current state)

1. **Migrations** to run in Supabase SQL editor: everything through **0066** (most recent:
   `0065_abn_unique.sql`, `0066_client_reputation.sql`).
2. **Edge Functions** to (re)deploy from the dashboard: `create-checkout`, `capture-payment`,
   `release-payment`, `verify-abn`, and the **new** `stripe-webhook` (**Verify JWT OFF**). Secrets:
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ABR_GUID`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`.
3. **Stripe webhook** endpoint → the `stripe-webhook` URL, listening to `checkout.session.completed`,
   `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.canceled`,
   `payment_intent.payment_failed`, `charge.refunded`.
4. **App**: nothing to paste — the working branch is mirrored to `snack-preview`; reload Expo.
