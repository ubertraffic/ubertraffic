# SiteCall — Questions for the Lawyer & Accountant

_A checklist to take into both meetings. These come from real decisions the product is blocked on.
This is a starting list, not legal/tax advice — let each professional expand it, and get the
classification answer **in writing.**_

---

## ★ The one question that governs everything (ask first, to both)

**Are the workers on SiteCall employees, independent contractors, or "employee-like workers" under the Fair Work Act (post–Closing Loopholes, in force Aug 2024)?**

Everything downstream — ABN, GST, super, workers comp, award rates, the invoice model, insurance —
flows from this one answer. Get it in writing.

---

## For the LAWYER

### Worker classification & platform regulation
1. Given we're a **digital labour platform** arranging work, are we captured by the **"employee-like worker" Minimum Standards** regime? What obligations apply to us (Minimum Standards Orders, the **"unfair deactivation"** rights from Feb 2025, record-keeping)?
2. If workers are **contractors**, what must the actual working relationship look like to avoid a **sham-contracting** finding (control, tools, ability to subcontract, etc.)? What in our app design helps or hurts that?
3. Do the modern **award minimums** (e.g. the 4-hour casual minimum in the Building & Construction Award) bind us at all, and if so, to whom?

### Work health & safety (NSW)
4. When we place a worker on a client's **construction site**, who is the **PCBU** (person conducting a business/undertaking) for WHS — us, the client, or both? What are **our** WHS duties given the app runs prestart/SWMS safety steps?
5. What's our exposure if a worker is **injured on site**, injures someone, or does **defective/unsafe work**? Who's liable, and how do we allocate it in our terms?

### Terms, liability & insurance
6. Draft/review our **worker contractor agreement** and **client terms of service** — what must they say to reflect the classification and cover **cancellations, no-shows, and disputes**?
7. What **insurance** must *we* carry, and what must we **require of workers and clients** — **workers compensation** (who's liable if they're contractors?), **public liability**, professional indemnity?

### Licensing (NSW)
8. For **licensed building work** (electrical, plumbing, building) under the **Home Building Act** — what are our duties as a platform connecting clients to licensed workers? Must we verify licences, and are we liable if unlicensed work happens through us?
9. Does operating a labour-style marketplace need a **licence of our own** in NSW — e.g. are we caught by **Labour Hire Licensing** laws?

### Money handling / financial services
10. We place a **card hold**, capture on approval, and pay workers out via **Stripe**. Does this make us a **payment facilitator / money remitter** needing an **AFSL, a payment-facilitator arrangement, or AUSTRAC registration** — or does Stripe as merchant-of-record cover us?
11. Is charging workers a **fee on instant payouts** (our ~1.5–2.5%) permissible, and how must it be **disclosed**?

### Privacy
12. We hold **legal names, dates of birth, ABNs, ID documents, GPS location history, and payment records.** What are our **Privacy Act / Australian Privacy Principles** obligations — Privacy Policy, collection notices, the **Notifiable Data Breaches** scheme, retention/destruction rules — and does holding ID/sensitive info raise the bar?

---

## For the ACCOUNTANT

### GST
13. Should **SiteCall register for GST** now, or at the $75k threshold? Is the threshold measured on **total transaction value** through the platform or just **our commission**?
14. In the **agent model**, who is the **"supplier" for GST** on the labour — the worker or us? Critically, does the **EDP (Electronic Distribution Platform) GST rule** apply to us — which can make the **platform** liable for GST on the underlying supply?
15. Are our **10% commission** and the **$3 booking fee** subject to GST, and how do we invoice/account for GST on **our own** fees?
16. Is the **instant-payout fee** a taxable supply?

### Invoicing structure — the decision that switches our invoice generator back on
17. **Who authors the tax invoice** to the client — the **worker** (worker-issued), or **SiteCall on the worker's behalf as an RCTI** (Recipient-Created Tax Invoice)? If RCTI: we'd need an **RCTI agreement** with each worker and **both** parties GST-registered — is that workable, or do we go worker-issued?
18. For **non-GST-registered** workers, confirm the document is a **plain invoice** (no GST, no "Tax Invoice" heading) — and exactly what it must show to avoid the **no-ABN 47% withholding**.

### Withholding & reporting
19. What **PAYG withholding** obligations do we have — the **no-ABN 47%** rule (if a worker doesn't quote an ABN), or full PAYG if any are employees? At what point (invoice surface? payout?) must we check/withhold?
20. Are we caught by the **Taxable Payments Annual Report (TPAR)** — building & construction businesses must report contractor payments to the ATO. Does the platform lodge a TPAR for what it pays workers? (If yes, that's a reporting feature we'd build.)
21. Any **Single Touch Payroll (STP)** obligation if any workers turn out to be employees?

### Super & our own tax position
22. If workers are contractors **paid mainly for their labour**, are we liable for **superannuation guarantee** anyway under the "contract wholly or principally for labour" extension? (This catches many platforms — it directly hits payout economics.)
23. For **our books**: we capture the full amount then transfer the worker's share. Is the worker's share **our income or a pass-through**? This affects our reported **turnover, GST, and the EDP question** — get the treatment confirmed.

---

## The product decisions their answers unlock (bring this list)

| Their answer on… | …unblocks this in the app |
|---|---|
| Employee vs contractor vs employee-like | The whole model (ABN, super, awards, terms) |
| Invoice author (RCTI vs worker-issued) | Switching the invoice generator on (it's built, parked) |
| SiteCall GST-registered? + EDP rule | Whether/how GST appears + our own fee GST |
| Super for labour-only contractors | Payout economics / pricing |
| TPAR obligation | A contractor-payment reporting feature |
| Instant-payout fee legality + disclosure | Keep, change, or re-word the fee |
| Insurance we must carry/require | What we mandate at onboarding |
| Withholding trigger point | A settlement/payout ABN guard |

**Two practical asks:**
- Get the **classification** answer **in writing.**
- Ask what **changes if we scale interstate** — awards, labour-hire licensing, and WHS duties differ by state.
</content>
