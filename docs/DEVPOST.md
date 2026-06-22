# AidLockIn

**Allocate scarce disaster aid once. Prove it everywhere.**

## Inspiration

In a disaster response, dozens of organizations show up at once — NGOs, government agencies, donors — and they don't share a system. So the same family quietly draws two food packs from two different NGOs across the street from each other, and the last shelter bed gets promised to two people at the same instant by two stations that never talked. The waste isn't malicious; it's structural. Nobody has a shared, real-time view of what a household has *already* received, and nobody can prove after the fact that a given unit of aid went out exactly once.

We wanted to fix that with a guarantee, not a dashboard. Not "here's a faster database" — but "two independent organizations, racing to allocate the exact same scarce resource at the exact same millisecond, get a *correct* outcome, enforced by the database itself rather than by application code a second server or a dropped packet could route around." That guarantee is the whole product.

## What it does

AidLockIn is a shared allocation ledger for a disaster response. Every partner organization checks and allocates aid through one flow:

- A field worker enters a household's anonymous claim code (no PII required) and the aid type they want to give out.
- The system checks, atomically, whether that household is already entitled to that aid type inside its policy window ("one food pack per 24 hours," "one shelter bed at a time"), and whether the actual physical resource is still available.
- It returns **APPROVED** or a specific denial — `DENIED_DUPLICATE`, `DENIED_NO_STOCK`, or `DENIED_RESOURCE_TAKEN` — and writes both outcomes to an append-only, hash-chained audit log. A denial is recorded just as permanently as an approval.

Around that core: a live dashboard with low-stock alerts, a resource-pool view with restock, a coordinator override queue for medically urgent exceptions, a duplicate-pattern report for donors and government, a filterable audit log with CSV export and independent chain re-verification, and a **race demo** that fires two stations at one last bed and shows exactly one winner.

## How we built it

- **Next.js 16** (App Router) and **React 19** for the UI and the thin API route handlers.
- **Amazon Aurora DSQL** as the production database — a serverless, distributed, PostgreSQL-compatible engine. All concurrency correctness leans on DSQL's optimistic concurrency control.
- **Vercel** for deployment, using the Aurora DSQL Marketplace integration: Vercel OIDC federation exchanges a short-lived OIDC token for AWS credentials, so no static AWS access keys ever touch the environment. `@vercel/functions`' `attachDatabasePool` keeps function instances warm long enough for pooled connections to drain cleanly.
- **Hand-written SQL, no ORM.** Every query in `lib/` is raw parameterized SQL. The two hero guarantees are unique-index collisions and conditional `UPDATE`s — exactly the kind of database-level enforcement an ORM tends to abstract away from you. We wanted that machinery in plain sight.
- **Dual backend behind one interface** (`lib/db.ts`): the same code runs against Aurora DSQL in production and a plain Postgres 16 container for local dev and CI, so you can develop the whole app without an AWS account.

## The two hero features (for judges)

### 1. Duplicate prevention enforced by the database, not by app code

Every aid type has a policy that maps to a deterministic, epoch-aligned **policy window bucket** string (`lib/policy.ts`). Each allocation attempt then tries to `INSERT` one row into `entitlement_claims`, guarded by a unique index:

```sql
CREATE UNIQUE INDEX uq_entitlement_claim
  ON entitlement_claims (event_id, household_id, aid_type_id, policy_window_bucket);
```

If the household already holds a claim in that window, the insert collides with the unique index, Postgres raises a `23505` unique-violation, and the attempt is cleanly denied as `DENIED_DUPLICATE` (`lib/allocation.ts`).

Why this matters: the obvious implementation — `SELECT` to check, then `INSERT` if absent — has a race. Two concurrent transactions can both read "no existing claim" before either has inserted, and both proceed. The unique index has no such gap: the database is the single source of truth *at insert time*. There is no window of time in JavaScript for a second request to slip through, because the check and the write are the same atomic operation.

### 2. Race-safe allocation via Aurora DSQL optimistic concurrency + connector retry

Consuming the actual resource is a conditional write. Fungible stock decrements only if some is left; a named unit (a specific shelter bed) flips to `ALLOCATED` only if it's still `AVAILABLE`:

```sql
UPDATE resources SET status = 'ALLOCATED', allocated_to_household_id = $1
  WHERE id = $2 AND status = 'AVAILABLE'
  RETURNING id, label;
```

If two stations target the same bed at the same instant, here's what actually happens on Aurora DSQL. DSQL doesn't block one transaction against the other — there is no `SELECT ... FOR UPDATE` to reach for. Both transactions proceed optimistically, as if uncontended. The conflict is only discovered at **commit time**: the *second* transaction to commit gets a `40001` serialization failure. The official `@aws/aurora-dsql-node-postgres-connector`'s `.transaction()` helper retries the whole transaction automatically on `40001` (`lib/db.ts`). By the time the retry runs, the winner's write is committed, so the loser's conditional `UPDATE` now matches zero rows — and it resolves to a clean, deterministic `DENIED_RESOURCE_TAKEN`.

The result: **exactly one APPROVED, exactly one DENIED**, with no application-level locking, no polling, and no UI coordination. `lib/race-demo.ts` fires both stations through the *same* `performAllocation()` the real field screen uses, via `Promise.allSettled`, against the same row — it's the production code path, not a scripted animation.

## Challenges we ran into

Aurora DSQL is PostgreSQL-compatible, but it is not Postgres, and its constraints shaped the design:

- **No foreign keys, triggers, or PL/pgSQL.** Referential integrity lives in the application layer (`lib/allocation.ts`); every "reference" column in `db/schema.sql` is a plain UUID with a comment noting what it conceptually points to. That forced us to be deliberate about where each invariant is actually enforced.
- **Asynchronous index creation.** A plain synchronous `CREATE INDEX` isn't how DSQL builds indexes on populated clusters. Every secondary index uses `CREATE INDEX ASYNC`, and `scripts/migrate.ts` polls `sys.wait_for_job` until each one finishes. DDL also can't be mixed with other DDL or with DML in one transaction, so the migrator runs every statement in its own transaction, in file order.
- **Audit payload stored as TEXT, not JSONB.** JSONB normalizes object key order when cast back to text, which would silently change the exact bytes being rehashed during audit verification and break every hash in the chain. We never query *into* the payload, so JSONB's indexing buys us nothing here — byte-for-byte fidelity with what was actually hashed matters more. So `audit_events.payload` is plain TEXT on purpose.
- **An uncached sequence for audit ordering.** The audit log needs a strictly-increasing, human-readable number ("Entry #482") that also serves as the ordering key `verifyAuditChain` walks. We declared `audit_seq` deliberately *without* `CACHE`: under connection pooling, a cached sequence can hand a connection a stale low value and let it write a row that happens-after a higher-numbered, already-committed one — inverting the exact ordering the column exists to guarantee. A few audit writes per allocation is nowhere near frequent enough to need cache's savings.

## Accomplishments we're proud of

- The hero guarantees are enforced by the database, not by hopeful application code — a unique-index collision and a conditional `UPDATE`, both of which a second server or a network blip cannot route around.
- The race demo runs the real allocation path, so "exactly one winner" is a property of the system, not a story we tell over a mockup.
- Denials are first-class: every attempt, approved or denied, is recorded, and the audit chain is independently re-verifiable.
- The audit verifier tolerates *legitimate* concurrency — two attempts in flight at once can fork from the same `prev_hash` — while still detecting any edit or deletion of a historical row.
- The whole app runs unmodified on plain Postgres for local dev and CI, so contributors don't need an AWS account to be productive.

## What's next

The productionization epic — turning the hackathon build into something an aid coalition could actually run:

- **Authentication and RBAC.** Real identities for field workers and coordinators, scoped per organization and per event, replacing the demo role switcher.
- **CI.** Run the hero-guarantee test suite automatically against a throwaway migrated database on every change.
- **Deployment.** A documented, repeatable Vercel + Aurora DSQL deploy path (the OIDC federation wiring already exists in `lib/db.ts`).
- Multi-region DSQL, richer policy windows, and partner onboarding flows beyond the seeded demo.

No invented numbers here — the claims above are exactly what the code does today.
