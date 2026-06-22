-- AidLockIn schema for Amazon Aurora DSQL

-- Written for DSQL's specific constraints (see AWS docs, "Working with Aurora
-- DSQL" guide, June 2026):
--   * No foreign keys, no triggers, no PL/pgSQL. Referential integrity is
--     enforced in the application layer (lib/allocation.ts), not the schema.
--     Every "reference" column below is a plain UUID with a comment noting
--     what it conceptually points to.
--   * UUID primary keys (DEFAULT gen_random_uuid()), not serial/identity —
--     sequential keys would hot-spot writes on one part of the keyspace.
--   * Sequences ARE supported and used once, deliberately: audit_events needs
--     a strictly-increasing human-readable number for the UI ("Entry #482"),
--     which a UUID can't give you.
--   * JSONB is supported (with compression), but audit_events.payload is
--     deliberately plain TEXT instead — see that table's comment for why.
--   * Every secondary index (unique or not) is created with
--     CREATE INDEX ASYNC and polled via sys.wait_for_job — see
--     scripts/migrate.ts. A plain synchronous CREATE INDEX is not how DSQL
--     builds indexes on populated clusters.
--   * Each statement below runs in its OWN transaction. DSQL does not allow
--     mixing DDL statements together, or DDL with DML, inside one
--     transaction. scripts/migrate.ts runs every statement one at a time in
--     the order they appear in this file — so don't reorder casually.
--   * Isolation is fixed (snapshot / optimistic concurrency) — there is no
--     SELECT ... FOR UPDATE to reach for. Concurrency safety here comes from
--     two database-enforced mechanisms instead: UNIQUE INDEXes (for "no
--     duplicate claim") and conditional UPDATE ... WHERE clauses (for "no
--     double-spend of a scarce resource"). See lib/allocation.ts for why.

-- Aid organizations participating across one or more disaster events.
CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  org_type   TEXT NOT NULL, -- 'NGO' | 'GOV' | 'DONOR' | 'OTHER'
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- One disaster response, e.g. "Typhoon Nari Kanto Response."
CREATE TABLE disaster_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  region     TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'CLOSED'
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Which organizations are coordinating on which event.
CREATE TABLE event_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL, -- disaster_events.id
  organization_id UUID NOT NULL, -- organizations.id
  joined_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC IF NOT EXISTS uq_event_partner
  ON event_partners (event_id, organization_id);

-- A household identified only by an anonymous claim code (NFR4: no PII
-- required to register or check entitlement).
CREATE TABLE households (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL,        -- disaster_events.id
  claim_code        TEXT NOT NULL,        -- e.g. "HX-8N2V"
  vulnerable        BOOLEAN NOT NULL DEFAULT false,
  created_by_org_id UUID,                 -- organizations.id
  created_at        TIMESTAMP NOT NULL DEFAULT now()
);

-- A claim code must mean exactly one household within an event — this is
-- what makes "find or create by claim code" race-safe.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS uq_household_claim_code
  ON households (event_id, claim_code);

-- A distributable aid category within an event, e.g. "Food pack" or
-- "Shelter bed." resource_model decides which child table holds the stock.
CREATE TABLE aid_types (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL,  -- disaster_events.id
  code           TEXT NOT NULL,  -- short slug, e.g. "FOOD_PACK"
  name           TEXT NOT NULL,  -- display name, e.g. "Food pack"
  icon           TEXT NOT NULL,  -- lucide-react icon key, see components/icons.ts
  resource_model TEXT NOT NULL,  -- 'POOL' (fungible count) | 'UNIT' (named units)
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC IF NOT EXISTS uq_aid_type_code
  ON aid_types (event_id, code);

-- The duplicate-prevention policy for an aid type: how often may the same
-- household receive it. See lib/policy.ts for how window_type/window_value
-- become a deterministic bucket string.
CREATE TABLE aid_policies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aid_type_id  UUID NOT NULL,  -- aid_types.id
  window_type  TEXT NOT NULL,  -- 'HOURS' | 'DAYS' | 'EVENT' | 'ACTIVE'
  window_value INTEGER,        -- e.g. 24 for HOURS, 7 for DAYS; null otherwise
  description  TEXT NOT NULL,  -- human copy, e.g. "one per household · per 24 hours"
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC IF NOT EXISTS uq_aid_policy_per_type
  ON aid_policies (aid_type_id);

-- Fungible stock for POOL-model aid types (food packs, cash vouchers,
-- medicine kits): a single count, decremented atomically per allocation.
CREATE TABLE resource_pools (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aid_type_id        UUID NOT NULL,  -- aid_types.id
  event_id           UUID NOT NULL,  -- disaster_events.id
  distribution_point TEXT,
  total_quantity     INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  updated_at         TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC IF NOT EXISTS uq_resource_pool_per_type
  ON resource_pools (aid_type_id);

-- Named, individually-trackable units for UNIT-model aid types (shelter
-- beds, transport seats): one row per physical unit.
CREATE TABLE resources (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 UUID NOT NULL,  -- disaster_events.id
  aid_type_id              UUID NOT NULL,  -- aid_types.id
  label                    TEXT NOT NULL,  -- e.g. "Bed A12", "Seat 14F"
  status                   TEXT NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE' | 'ALLOCATED'
  allocated_to_household_id UUID,          -- households.id
  allocated_by_allocation_id UUID,         -- allocations.id
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS ix_resources_lookup
  ON resources (aid_type_id, status);

-- THE hero index. One row per (household, aid type, policy window) is
-- physically impossible to insert twice — that's the entire duplicate-claim
-- guarantee, enforced by Aurora DSQL itself rather than application logic
-- that a concurrent request could race past. is_override marks rows created
-- through a coordinator-approved exception (see lib/allocation.ts) so
-- "duplicates prevented" stats can exclude them.
CREATE TABLE entitlement_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL,  -- disaster_events.id
  household_id        UUID NOT NULL,  -- households.id
  aid_type_id         UUID NOT NULL,  -- aid_types.id
  policy_window_bucket TEXT NOT NULL,
  allocation_id       UUID,           -- allocations.id, linked after insert
  is_override         BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC IF NOT EXISTS uq_entitlement_claim
  ON entitlement_claims (event_id, household_id, aid_type_id, policy_window_bucket);

-- One row per successfully approved allocation (the ledger of aid that was
-- actually given out).
CREATE TABLE allocations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL,  -- disaster_events.id
  household_id        UUID NOT NULL,  -- households.id
  aid_type_id         UUID NOT NULL,  -- aid_types.id
  resource_id         UUID,           -- resources.id, for UNIT model
  pool_id             UUID,           -- resource_pools.id, for POOL model
  organization_id     UUID NOT NULL,  -- organizations.id, who allocated it
  distribution_point  TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'OVERRIDDEN' | 'CANCELLED'
  is_override         BOOLEAN NOT NULL DEFAULT false,
  override_request_id UUID,           -- override_requests.id, if applicable
  created_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS ix_allocations_event
  ON allocations (event_id, created_at);

-- One row per "Check & allocate" tap, success or failure — the complete
-- record of every attempt, which is what makes denials auditable too
-- (NFR3), not just approvals.
CREATE TABLE allocation_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL,  -- disaster_events.id
  household_id          UUID,           -- households.id
  household_claim_code  TEXT NOT NULL,  -- raw input, kept even if lookup failed
  aid_type_id           UUID NOT NULL,  -- aid_types.id
  organization_id       UUID NOT NULL,  -- organizations.id
  worker_name           TEXT NOT NULL,
  distribution_point    TEXT,
  idempotency_key       TEXT NOT NULL,
  result                TEXT NOT NULL,  -- 'PENDING' | 'APPROVED' | 'DENIED_DUPLICATE' |
                                         -- 'DENIED_NO_STOCK' | 'DENIED_RESOURCE_TAKEN' | 'ERROR'
  denial_reason         TEXT,
  allocation_id         UUID,           -- allocations.id, if approved
  simulated_region      TEXT,           -- 'Tokyo' | 'Osaka', race-demo only
  created_at            TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS ix_attempts_event
  ON allocation_attempts (event_id, created_at);

-- A field worker's request for a coordinator to approve an exception to a
-- denied allocation (e.g. a medically urgent duplicate claim).
CREATE TABLE override_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               UUID NOT NULL,  -- disaster_events.id
  household_id           UUID NOT NULL,  -- households.id
  aid_type_id            UUID NOT NULL,  -- aid_types.id
  allocation_attempt_id  UUID,           -- allocation_attempts.id, the denied attempt
  requested_by_org_id    UUID NOT NULL,  -- organizations.id
  requested_by_name      TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
  decided_by_name        TEXT,
  decision_note          TEXT,
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  decided_at             TIMESTAMP
);

CREATE INDEX ASYNC IF NOT EXISTS ix_overrides_event_status
  ON override_requests (event_id, status, created_at);

-- A strictly-increasing, human-readable counter for audit entries
-- ("Entry #482"), and the ordering key
-- verifyAuditChain() relies on to walk the log oldest-first.
--
-- This is deliberately not cached. CACHE pre-allocates a block of values to
-- whichever connection first calls nextval(), for that connection to hand
-- out locally without round-tripping back to the sequence. Under connection
-- pooling, that means a connection that grabbed a high block early can sit
-- on low, already-stale values, and later hand one of them to a write that
-- happens-after another connection's already-committed higher-numbered row.
-- That inverts the exact ordering this column exists to guarantee, and
-- silently breaks every audit entry that cites the affected row as its
-- prev_hash. A handful of audit writes per allocation is nowhere near
-- frequent enough to need cache's coordination-cost savings — correctness
-- of the ordering matters far more here than shaving a round trip.
CREATE SEQUENCE audit_seq;

-- The append-only, hash-chained audit log. See lib/audit.ts for how
-- prev_hash/hash are computed and verified — deliberately tolerant of
-- legitimate concurrent writes (e.g. both sides of the race demo) forking
-- from the same prev_hash, while still being tamper-evident.
CREATE TABLE audit_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_no              BIGINT NOT NULL DEFAULT nextval('audit_seq'),
  event_id              UUID NOT NULL,  -- disaster_events.id
  action                TEXT NOT NULL,
  actor_name            TEXT,
  actor_role            TEXT,
  organization_id       UUID,           -- organizations.id
  household_id          UUID,           -- households.id
  household_claim_code  TEXT,
  aid_type_id           UUID,           -- aid_types.id
  detail                TEXT NOT NULL,
  -- Stored as plain TEXT, not JSONB, on purpose: JSONB normalizes object key
  -- order when cast back to text, which would silently change the bytes
  -- being rehashed during verification and break every hash in the chain.
  -- We never query into this field, so JSONB's indexing benefits buy us
  -- nothing here — byte-for-byte fidelity with what was actually hashed
  -- matters far more.
  payload               TEXT,
  prev_hash             TEXT NOT NULL,
  hash                  TEXT NOT NULL,
  -- TIMESTAMPTZ (not TIMESTAMP) on purpose: the audit hash commits to this
  -- value as a UTC ISO string. A tz-naive TIMESTAMP is read back by the driver
  -- in the server's local timezone, so verifyAuditChain() would recompute a
  -- different instant and every hash would fail to verify outside UTC. A
  -- timezone-aware column round-trips the exact instant on any backend.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS ix_audit_event_order
  ON audit_events (event_id, audit_no);
