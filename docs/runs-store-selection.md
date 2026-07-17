# Design note — Route-aware store selection for runs (DEFERRED)

**Status: captured, NOT built.** Revisit only when real workers are actually doing runs and
route inefficiency is observable. Today, *"the worker goes to whatever store and it works"* is
acceptable. This is an efficiency optimisation with no proven problem yet — do not build it on
speculation, and do not layer it onto runs Phase 1 before real use proves it out.

---

## Problem

A **run** = a worker buys materials from a store and drops them at a job site. Today "where to
buy" is a single free-text field (`requests.pickup_text`). If the worker is near a *different*
branch of the same chain than the one the client typed, forcing the client's branch wastes the
worker's time, inflates the run cost, and slows delivery — for no benefit, since chain pricing is
identical at any branch.

## Why this is deferred

1. **No measured problem.** No real runs have happened yet. Optimising dispatch for an
   inefficiency nobody has hit is premature.
2. **It touches critical code.** A route-aware version rewrites `dispatch_for_item`, which sits
   next to the **atomic accept-lock** (the heart of the system — CLAUDE.md §0, §2). That function
   must not be rewritten from inference — only from its real body, with the unhappy paths tested.

## The model — store as *intent*, not an address

Three pickup modes on a run:

- **`any_chain`** *(default)* — client picks a chain ("any Bunnings"). Worker goes to whichever
  branch is best on their route. The common case.
- **`exact`** — client pins a specific branch (trade account, held stock, prepaid
  click-and-collect). Fixed.
- **`items_only`** — client lists goods + cap; store is irrelevant; worker buys wherever's valid.

**Data shape (when built):** `requests.pickup_mode`, `pickup_chain`, `pickup_store_id` (FK
`stores`); `assignments.chosen_store_id` (the branch actually used). Keep `pickup_text` as a free
note.

## Data dependency — a seeded NSW `stores` table

Route-awareness needs branch coordinates. **Recommended: a seeded `stores` table**
(`id, chain, name, address, lat, lng, geog(point)`) loaded once with the major NSW trade chains
(Bunnings, Mitre 10, Total Tools, etc.). Free, instant in-DB, under our control; refresh
periodically. A live Places API (Google/Mapbox) is the alternative but adds latency, cost, and a
key per dispatch-time lookup — not recommended.

## The route-aware ranking (DoorDash-style — *both* legs count)

For candidate worker **W**, drop-off **D**, allowed branches **B₁…Bₙ**:

```
run_cost(W)    = min over i of [ dist(W→Bᵢ) + dist(Bᵢ→D) ]
best_branch(W) = the Bᵢ that achieves that minimum
```

Dispatch ranks/gates eligible (online + `can_task`) workers by `run_cost` and stamps
`best_branch` on the offer — so a worker near a good branch becomes the efficient match
automatically, without forcing anyone to the client's branch. Distance = **haversine in PostGIS**
for matching (free, consistent with existing geo-dispatch like `operator_coverage`/`demand_heat`);
optional road-routing only for the *displayed* ETA.

- `any_chain` → minimise over the chain's branches.
- `exact` → single branch: `run_cost = dist(W→B) + dist(B→D)`.
- `items_only` → minimise over all relevant stores, or rank by site-proximity and let the worker
  choose.

## Pricing / anti-fraud (unchanged spine)

Spend cap + itemised receipt is the control (TaskRabbit reimbursement model). With a flexible
store you can't pre-price, so: **the receipt's store name must match the allowed chain** (any
branch passes; a wrong chain flags); over-cap needs client approval; chain pricing keeps variance
small. For `exact` + prepaid (click-and-collect), the run becomes a **collect** — no cap, no shop,
just proof of pickup (Uber store-pickup model).

## Proof of pickup

Receipt store-name matches the allowed chain/store **+** the existing drop-off photo.
Geofence-at-store is a later nice-to-have, not required for v1.

## Worker / client UX (when built)

- **Client post:** "Where to buy?" → *Any [chain] ▾* · *A specific store* · *Just the items*.
  Default **Any Bunnings**.
- **Worker:** RunBrief shows the suggested branch (name, map, the small detour it adds) + "use a
  different [chain]" to swap, recomputed against `stores`.

## Build guardrails (when the time comes)

- **Do NOT rewrite `dispatch_for_item` from inference.** Get the real function body first; treat
  it as accept-lock-adjacent, security-critical; test the unhappy paths (CLAUDE.md §0, §2, §5).
- Migrations for the `stores` table + `pickup_*` columns.
- Server-side validation of receipt-chain-match and the spend cap.

## Research foundation (verified sources)

- DoorDash dispatch minimises total time across both legs (dasher→store, store→customer) +
  batching — <https://careersatdoordash.com/blog/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/>;
  H3-grid ETAs — <https://medium.com/@airongopal2529/how-doordash-delivers-fast-and-accurate-etas-using-h3-grids-9af76eb3783b>
- Instacart: retailer→store model, preloaded card, real-time fraud checks —
  <https://tech.instacart.com/real-time-fraud-detection-with-yoda-and-clickhouse-bd08e9dbe3f4>
- Uber store pickup — prepaid click-and-collect (locked store, collect not shop) —
  <https://www.uber.com/au/en/newsroom/skip-a-trip-with-store-pickup/>
- TaskRabbit expense/reimbursement (front cost, receipt, client reimburses) —
  <https://support.taskrabbit.com/hc/en-us/articles/34799251327373-The-Taskrabbit-Expense-Policy>
- DoorDash package pickup — proof is photo **+** verification, not photo alone —
  <https://help.doordash.com/en-us/dashers/article/package-pickup>

## Trigger to revisit

When real workers are doing runs and route inefficiency shows up in the data — workers detouring
to far branches, runs taking too long or costing too much.
