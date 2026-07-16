# SiteCall — Product Constitution

SiteCall is "Uber for construction labour" — Sydney/NSW. Tagline: "Help, on
site, now." It connects people who need workers on a site with verified workers
nearby. Two sides: Hire (clients) and Work (operators/workers).

## Working with the founder — read this first

The founder is non-technical. They have strong product instincts and clear
standards, but they do not read or write code. This changes how you must work:

- Explain everything in plain language. No jargon without a plain-English
  translation. Assume no coding knowledge.
- Before you commit any change, show a short plain-English summary of what you
  changed and why, plus the diff. Wait for approval.
- Work one task at a time. Don't bundle several changes together — it makes them
  impossible to review.
- When a change is risky (touches money, safety, login, or the database), say so
  loudly and clearly before doing it.
- If a request is ambiguous, ask one clear question rather than guessing.
- Prefer subtraction. The simplest change that works is the right one. Don't add
  things that weren't asked for.
- Never make the founder hunt for lines of code or edit files by hand. You do the
  editing; they review and approve.
- If something can't be done safely or you're unsure, say so honestly. Don't
  pretend or paper over it.

## Product laws

1. **Money and safety come first.** Anything touching payment, worker pay, or
   site safety is handled with maximum care and server-side enforcement. Never
   cut corners here.
2. **One source of truth.** Every piece of state has one home. Never show the
   user two versions of the same fact.
3. **Sell confidence to clients, opportunity to workers.** The client side should
   always feel like "help is coming." The worker side should always feel like
   "here's where the money is."
4. **Honesty over polish.** Never show a fake ETA, a fake status, or a success
   message for something that didn't happen. If the app doesn't know, it says so
   plainly.
5. **Every screen answers one question.** Don't overload. If a screen is trying
   to say three things, it's saying nothing.
6. **Degrade honestly.** Bad signal, denied GPS, app killed mid-job — handle
   these gracefully and never lie about what was captured.
7. **Plain language for tradies.** Buttons and messages read the way a person on
   a worksite talks. No corporate voice.
8. **The platform leads.** The app guides the user to the next right action; it
   never leaves them wondering what to do.

## Before shipping any feature

Run an honest self-check: what's the weakest part of this, and why isn't it a 10
out of 10? Name a real weakness — not theatre. If you can't find one, look harder.
