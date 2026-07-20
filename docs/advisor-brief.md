# SiteCall — How It Actually Works (Brief for Legal & Tax Advisors)

_A factual description of the platform's mechanics, so classification, GST, payment-regulation, WHS and
privacy questions can be assessed against what the app really does. No positions are taken here — this
is a description, not advice or argument._

**Status:** pre-launch, Stripe in **test mode**, NSW focus. Reviewed by the founder alongside a separate
questions checklist.

---

## 1. What SiteCall is
A two-sided marketplace connecting **clients** (builders/site managers who need labour on a site) with
**workers** (traffic controllers, labourers, trades, plant operators, delivery/errand runners). A client
posts a job; nearby workers are notified and one takes it; the worker travels to site, does the job, and
is paid once the client approves the work. Built in React Native (Expo), backend on Supabase (Postgres),
payments via **Stripe Connect**.

## 2. Worker selection & control model _(relevant to classification / "employee-like worker")_
- Workers **choose when to work** — they go "online" when they want; there is **no guaranteed work** and
  no rostering.
- Jobs are **dispatched to nearby workers**, and the **first to accept locks it** (an atomic "accept" —
  first-come). Workers can **decline/ignore** any job with no penalty in the current build.
- There is **no auto-assignment, no AI ranking, and no client hand-picking** of a specific worker in the
  current build. The platform does **not** set who gets a job beyond geographic dispatch.
- Workers supply their **own tickets/licences and vehicles**, can hold multiple skills, and are free to
  work elsewhere. Pay per job is set by the posted rate; workers accept or not.
- _(Design note for the lawyer: the founder is deliberately keeping platform control low. A specific
  question in the checklist asks how much matching/ranking could be added before it changes the picture.)_

## 3. Payment flow _(relevant to GST agent-vs-supplier, payment regulation, and "who bears non-payment")_
1. Client posts a job → a worker accepts.
2. Once a worker is on the job, the client's card is **authorised (a hold)** via Stripe manual-capture —
   funds are **reserved up front**, not yet charged.
3. Worker completes the job; the client **approves**.
4. On approval, SiteCall **captures the held funds** and then **transfers the worker's share to the
   worker's own Stripe Connect (Express) account.** The worker is paid **from the client's captured
   funds — SiteCall does not front or lend the money.**
5. If the client **cancels** before approval, the hold is **released** (authorisation voided).
6. If the client **goes silent**, the job **auto-approves after a set window** in the system. _(Known gap
   the founder is aware of: auto-approval currently records the amount owed but does not itself trigger
   the Stripe capture/transfer — a fix is planned; the policy question "does SiteCall guarantee the worker
   or recover from the client first" is in the checklist.)_
7. Card details are entered on **Stripe's hosted page** and **never touch SiteCall**. Worker bank details
   are entered on **Stripe's** onboarding and never touch SiteCall.

**Money custody:** SiteCall is the platform on a Stripe Connect arrangement; it captures the client charge
and initiates transfers to connected accounts. It does not hold a pooled float of user money in its own
bank account.

## 4. Fees / money model _(relevant to GST)_
- **Labour (hourly):** the worker keeps 90%; SiteCall's commission is **10% of labour**.
- **Tasks (fixed-price):** the worker keeps 100%; the client pays a flat **$3 booking fee** per spot.
- **Travel allowance and tips:** **100% to the worker.**
- **Instant payout (optional):** a worker can cash out early for a fee (~2.5%, covering Stripe's instant
  cost plus a small margin); standard payouts are free.
- All amounts in **AUD**. A per-worker **"registered for GST" flag** is captured; when set, the (parked)
  invoice breaks out the 10% GST already inside the GST-inclusive price.

## 5. Verification & safety features _(relevant to WHS and classification)_
The platform actively manages risk, which may be relevant to WHS duties:
- **ABN** captured and **verified against the ABR register** (name-matched, not self-granted).
- **Licences/tickets** (White Card, trade licences, insurances) captured with evidence and verified;
  a worker can't self-mark them "verified."
- **Geofenced check-in** (server blocks check-in >300 m from site).
- **Pre-start / SWMS safety gate** (reg-291 hazard questions; high-risk work requires a SWMS
  acknowledgement before the job is workable).
- **Photo proof + named sign-off** at completion; **two-way ratings**.

## 6. Data collected & handling _(relevant to Privacy Act / APPs)_
Collected: **legal name, date of birth, ABN, photo ID / evidence documents, GPS location history
(during jobs), payment records, ratings, contact details.** Handling:
- Row-Level Security on every table; sensitive identity columns (legal name, DOB, ABN) are **column-locked**
  so a counterparty can't read them via the API.
- ID/evidence documents sit in **private, owner-only** storage.
- **Card data is held by Stripe**, never by SiteCall.
- No published Privacy Policy / Collection Notice / retention & breach-response plan yet — flagged for the
  lawyer to specify.

## 7. What's decided vs parked
- **Live/working (test mode):** the full post → accept → work → approve → pay → payout loop; ABN & payout
  gating; verification; two-way ratings.
- **Parked pending advice:** the **tax-invoice generator** is built but switched **off** until the invoice
  author/structure (worker-issued vs RCTI) is confirmed. Field capture (ABN, GST status, licence, ABR
  business name) is done and structure-agnostic.
- **Not yet built:** anything that depends on the classification/GST/super answers.

---

_Prepared to help advisors assess the real mechanics. Please treat every figure and flow as "as currently
built in test mode" — the founder can change any of it based on your advice._
