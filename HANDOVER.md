# AidLockIn — Developer Handover

**Prepared by:** Claude (AI pair programmer)
**Date:** June 2026
**Handover to:** Next teammate

---

## What this project is

AidLockIn is a disaster aid allocation platform built for the **AWS Databases + Vercel hackathon**. The core problem it solves: when multiple NGOs and government agencies respond to the same disaster, the same household can walk up to different organizations and receive the same aid twice, while others receive nothing. AidLockIn gives every partner a shared, real-time view of who has already received what — enforced at the database level, not the application level.

The two technical hero features for the hackathon judges:

1. **Duplicate prevention** — a unique index on `entitlement_claims(event_id, household_id, aid_type_id, policy_window_bucket)` makes it physically impossible to INSERT a duplicate claim. The database rejects it, not application code that a concurrent request could race past.
2. **Race-safe resource allocation** — the race demo fires two real allocation requests at the exact same shelter bed simultaneously. Exactly one wins. Aurora DSQL's optimistic concurrency control (OCC) handles the conflict at commit time and the connector retries the loser automatically.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9 (App Router, TypeScript) |
| Frontend | React 19.2.4, Tailwind CSS v4 (CSS-first `@theme`) |
| Database (production) | Amazon Aurora DSQL |
| Database (local dev) | Any Postgres 14+ via `DATABASE_URL` |
| DB connector | `@aws/aurora-dsql-node-postgres-connector` v0.1.9 |
| Hosting | Vercel |
| Auth | None — demo role switcher only |
| Icons | lucide-react v1.20.0 |
| Node.js required | >=20.9.0 |

---

## Project structure

```
aidlockin/
├── .env.example                  Copy to .env.local, fill in DATABASE_URL
├── README.md                     Full setup + deploy + demo script
├── db/
│   └── schema.sql                Full DDL for Aurora DSQL
├── scripts/
│   ├── migrate.ts                npm run db:migrate
│   └── seed.ts                   npm run db:seed
├── lib/                          All business logic — no framework dependency
│   ├── db.ts                     Database connector (DSQL or plain Postgres)
│   ├── types.ts                  All shared TypeScript types
│   ├── allocation.ts             Core allocation engine
│   ├── audit.ts                  Hash-chained audit log
│   ├── overrides.ts              Override request/decision flow
│   ├── race-demo.ts              Two-station concurrency demo
│   ├── policy.ts                 Policy window bucket computation
│   ├── ids.ts                    Claim code + idempotency key generation
│   ├── utils.ts                  cn(), formatRelativeTime(), shortHash()
│   └── api.ts                    Shared route helpers (withErrorHandling etc)
├── app/
│   ├── layout.tsx                Root layout: fonts, AppStateProvider, Sidebar
│   ├── globals.css               Tailwind v4 theme tokens + component classes
│   ├── page.tsx                  / Overview
│   ├── dashboard/page.tsx        /dashboard
│   ├── field/page.tsx            /field — hero allocation flow
│   ├── race-demo/page.tsx        /race-demo — dark theme concurrency demo
│   ├── pools/page.tsx            /pools — stock overview + add aid types
│   ├── events/new/page.tsx       /events/new
│   ├── overrides/page.tsx        /overrides — coordinator queue
│   ├── audit/page.tsx            /audit — filterable log + CSV export
│   ├── reports/page.tsx          /reports — donor-facing impact summary
│   └── api/
│       ├── events/route.ts
│       ├── organizations/route.ts
│       ├── aid-types/route.ts
│       ├── allocate/route.ts
│       ├── race-demo/route.ts
│       ├── overrides/route.ts
│       ├── overrides/decision/route.ts
│       ├── audit/route.ts
│       ├── export/route.ts
│       └── stats/route.ts
└── components/
    ├── app-shell/
    │   ├── providers.tsx          Global state: role, eventId, orgs, refreshKey
    │   ├── sidebar.tsx            Nav + role switcher
    │   └── topbar.tsx             Event picker + identity pill
    ├── ui/
    │   ├── button.tsx             Variants: primary/secondary/ghost/danger/success
    │   ├── card.tsx
    │   ├── badge.tsx              Tones: neutral/primary/success/warning/danger
    │   ├── input.tsx              Input, Textarea, Select
    │   └── tabs.tsx               Generic typed tabs with count badges
    ├── audit-meta.tsx             Action → icon/label/tone map (Tailwind-safe)
    ├── icons.ts                   Aid type icon registry (lucide-react)
    └── stat-tile.tsx              Reusable stat tile
```

---

## How to run locally

**Requirements:** Node.js >=20.9 and any Postgres 14+ database.

```bash
# 1. Install dependencies
npm install

# 2. Set up env
cp .env.example .env.local
# Open .env.local and set:
# DATABASE_URL=postgresql://user:password@localhost:5432/yourdb

# 3. Create tables
npm run db:migrate

# 4. Load demo data
npm run db:seed

# 5. Start the app
npm run dev
# Open http://localhost:3000
```

If you don't have Postgres locally, the fastest option is a free Neon database at neon.tech — paste the connection string it gives you as `DATABASE_URL`.

If you have Docker: `docker run --name aidlockin-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16` then use `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`.

---

## How to deploy to Vercel

1. Push to a Git repo and import into Vercel.
2. On the project's **Integrations** tab, install the **Amazon Aurora DSQL** integration from the Vercel Marketplace. This provisions a DSQL cluster and injects all env vars automatically (`PGHOST`, `PGUSER`, `PGDATABASE`, `PGPORT`, `AWS_REGION`, `AWS_ROLE_ARN`) including OIDC-federated credentials — no AWS keys needed.
3. After first deploy: run `vercel env pull` to get the injected vars locally, then `npm run db:migrate && npm run db:seed` pointing at the DSQL cluster.
4. Redeploy or visit the live URL.

---

## Key design decisions (read before changing anything)

### 1. Why `audit_events.payload` is TEXT not JSONB
Postgres's `::text` cast on a JSONB column reorders object keys to its own canonical order. That changes the bytes being hashed during chain verification, so every single hash in the log would fail to recompute. Plain TEXT preserves byte-for-byte exactly what was hashed at insert time. Do not change this column to JSONB.

### 2. Why `audit_seq` has no CACHE clause
`CACHE N` pre-allocates a block of N sequence values to whichever connection first calls `nextval()`. Under connection pooling, a connection holding a high block can hand out values for writes that happen chronologically *after* another connection's already-committed higher-numbered writes — inverting the ordering the chain verification logic depends on. `audit_no` must be monotonically increasing in real commit order. No cache. Do not add `CACHE` back.

### 3. Why `CREATE INDEX ASYNC` is used for all secondary indexes
Aurora DSQL builds indexes asynchronously and returns a `job_id` immediately. The migration script collects all job IDs and polls `sys.wait_for_job()` before finishing. On plain Postgres, `migrate.ts` strips the `ASYNC` keyword and creates them synchronously. Do not write synchronous `CREATE INDEX` statements in `schema.sql` — they will fail on DSQL.

### 4. Why there are no dynamic `[param]` route segments in `app/api/`
Next.js 16 requires `params` to be awaited as a Promise in dynamic route handlers. To sidestep this, all routes use flat paths with POST body or query string for IDs (e.g. `/api/overrides/decision` takes `{ id }` in the body rather than `/api/overrides/[id]/decision`). Do not add `[param]` segments without handling the async params pattern.

### 5. Why `targetResourceId` exists on `AllocateRequest`
The normal allocation engine gracefully falls back to the next available unit if its first pick is already taken — correct behavior for a real field worker. But the race demo needs both stations to contend for the *exact same* bed with no fallback. `targetResourceId` bypasses the fallback loop and claims only the specified row or returns `DENIED_RESOURCE_TAKEN`. Used only by `lib/race-demo.ts`.

### 6. Why Tailwind classes are never interpolated
Tailwind v4 statically scans source files for class names. A template literal like `` `bg-${tone}-tint` `` is never seen by the scanner so the CSS is never generated. `components/audit-meta.tsx` has `TONE_ICON_BG` and `TONE_ICON_TEXT` lookup maps where every class string is spelled out in full. Always use these maps rather than string interpolation for tone-based styling.

### 7. Why `resolveOrCreateHousehold()` runs outside the main transaction
If household registration was inside the allocation transaction and the allocation then failed (e.g. no stock), the household row would be rolled back too. Households are registered permanently regardless of whether the allocation succeeded — a household that was denied still exists. This is intentional.

### 8. Why both pool instances have `error` event listeners
`pg.Pool` emits `'error'` on idle-client connection drops. With no listener, Node.js treats it as an uncaught EventEmitter error and can crash the process. The listeners in `lib/db.ts` are load-bearing, not decorative. Do not remove them.

---

## Database schema — tables at a glance

| Table | Purpose |
|---|---|
| `organizations` | NGOs, government agencies, donors |
| `disaster_events` | One per emergency response |
| `event_partners` | Which orgs are on which event |
| `households` | Anonymous, identified by claim code only |
| `aid_types` | Food pack, shelter bed, etc. — POOL or UNIT model |
| `aid_policies` | Duplicate window per aid type |
| `resource_pools` | Fungible stock count for POOL types |
| `resources` | Named individual units for UNIT types (specific beds/seats) |
| `entitlement_claims` | **The hero table** — unique index enforces no-duplicate guarantee |
| `allocation_attempts` | Every attempt including denials — full audit of what was tried |
| `allocations` | Successful allocations only — the ledger of aid given |
| `override_requests` | Field worker exception requests + coordinator decisions |
| `audit_events` | Hash-chained append-only log |

---

## Demo role switcher — who is who

The sidebar "View as" control switches between four personas. There is no real authentication.

| Role | Identity | Organization |
|---|---|---|
| Field | A. Yusuf | Hope Relief (NGO) |
| Coordinator | M. Tanaka | Kanto Prefecture (GOV) |
| Donor | Donor Partner | (first DONOR org) |
| Admin | System Admin | AidLockIn HQ |

Role affects: which org ID is used for API calls, which UI affordances are shown (e.g. only Coordinator/Admin can approve overrides), and the identity pill in the topbar.

---

## What's implemented vs not

### Implemented and working
- Full allocation engine with duplicate prevention and race-safe resource claiming
- Race demo (two stations, one bed, real DB concurrency, repeatable)
- Hash-chained audit log with chain verification and CSV export
- Override request + coordinator approve/reject flow
- All 9 pages and 10 API routes
- Migration + seed scripts
- Dashboard stats, pools stock view, reports page
- Demo role switcher

### Not implemented (known gaps)
| Gap | Where to add it |
|---|---|
| Create new organizations via UI | New page + `POST /api/organizations` |
| Real QR code camera scan | Replace the button in `app/field/page.tsx` with a camera library like `html5-qrcode` |
| CSV import for resource pools | New route `POST /api/import` + UI on pools page |
| Live auto-refresh on pools page | Add `setInterval` poll in `app/pools/page.tsx` |
| Low-stock alerts | Check `remaining_quantity` in `/api/stats` and surface a warning |
| Restock a pool via UI | `PATCH /api/aid-types` route + button on pools card |
| Offline draft mode | Would need a service worker + local queue — significant work |
| Real authentication / org-level access control | Replace role switcher with NextAuth or Clerk |
| Unusual duplicate-claim pattern detection | Aggregate query on `allocation_attempts` grouped by household + time window |

---

## Commands reference

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build check
npm run db:migrate   # Apply db/schema.sql to the database
npm run db:seed      # Seed the Typhoon Nari demo event
npx tsc --noEmit     # TypeScript check (should print nothing if clean)
```

---

## Files to look at first

If you're picking this up and want to understand how it works, read these in order:

1. `lib/types.ts` — all the data shapes in one place
2. `lib/db.ts` — how the database connection works
3. `lib/allocation.ts` — the core transaction (this is the heart of the system)
4. `db/schema.sql` — the actual tables and why they're designed that way
5. `components/app-shell/providers.tsx` — how global state flows to every page
6. `app/field/page.tsx` — the most important user-facing screen

---

## Questions / things to watch out for

**"The pages load but show no data"** — Almost always means the seed script hasn't been run, or `DATABASE_URL` points at an empty database. Run `npm run db:migrate && npm run db:seed`.

**"Audit chain shows as not verified"** — If you've manually inserted rows into `audit_events` directly via SQL, they won't have the correct `prev_hash`/`hash` values. Always write audit events through `appendAuditEvent()` in `lib/audit.ts`, never with a raw INSERT.

**"Adding a new aid type breaks the icon"** — The icon field must be one of the keys in `AID_TYPE_ICONS` in `components/icons.ts`: `package`, `banknote`, `syringe`, `bed-double`, `bus`. Add new icons there first before using them in a seed or form.

**"Tailwind styles not applying to a new component"** — If you're using a tone-based class like `bg-success-tint`, spell it out fully in the source. Don't construct it from a variable. See design decision #6 above.

**"TypeScript errors after pulling changes"** — Run `npm install` first in case a new dependency was added, then `npx tsc --noEmit` to see the exact errors.
