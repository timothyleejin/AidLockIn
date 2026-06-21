// Shared types mirroring the database schema (see db/schema.sql).
// Kept hand-written (no ORM) so the API routes and UI agree on one contract.

export type ResourceModel = "POOL" | "UNIT";

export type WindowType = "HOURS" | "DAYS" | "EVENT" | "ACTIVE";

export type EventStatus = "ACTIVE" | "CLOSED";

export type ResourceStatus = "AVAILABLE" | "ALLOCATED";

export type AllocationStatus = "ACTIVE" | "OVERRIDDEN" | "CANCELLED";

export type AttemptResult =
  | "APPROVED"
  | "DENIED_DUPLICATE"
  | "DENIED_NO_STOCK"
  | "DENIED_RESOURCE_TAKEN"
  | "ERROR";

export type OverrideStatus = "PENDING" | "APPROVED" | "REJECTED";

export type DemoRole = "FIELD" | "COORDINATOR" | "DONOR" | "ADMIN";

export type AuditAction =
  | "EVENT_CREATED"
  | "AID_TYPE_CREATED"
  | "POOL_RESTOCKED"
  | "ALLOCATION_APPROVED"
  | "ALLOCATION_DENIED_DUPLICATE"
  | "ALLOCATION_DENIED_NO_STOCK"
  | "ALLOCATION_DENIED_RESOURCE_TAKEN"
  | "OVERRIDE_REQUESTED"
  | "OVERRIDE_APPROVED"
  | "OVERRIDE_REJECTED";

export interface Organization {
  id: string;
  name: string;
  org_type: string;
  created_at: string;
}

export interface DisasterEvent {
  id: string;
  name: string;
  region: string | null;
  status: EventStatus;
  created_at: string;
  partner_count?: number;
}

export interface AidType {
  id: string;
  event_id: string;
  code: string;
  name: string;
  icon: string;
  resource_model: ResourceModel;
  window_type: WindowType;
  window_value: number | null;
  policy_description: string;
  // POOL summary
  total_quantity?: number | null;
  remaining_quantity?: number | null;
  // UNIT summary
  available_units?: { id: string; label: string }[];
  available_count?: number;
  allocated_count?: number;
  pool_id?: string | null;
}

export interface AllocateRequest {
  eventId: string;
  claimCode: string;
  aidTypeId: string;
  organizationId: string;
  workerName: string;
  distributionPoint: string;
  idempotencyKey: string;
  simulatedRegion?: string;
  /** Forces contention on one specific named unit — used by the race demo. */
  targetResourceId?: string;
}

export interface AllocateResponse {
  result: AttemptResult;
  attemptId: string;
  auditNo: number | null;
  message: string;
  detail?: string;
  householdClaimCode: string;
  aidTypeName: string;
  resourceLabel?: string;
  remaining?: number;
  overrideEligible: boolean;
  existingClaim?: {
    organizationName: string;
    claimedAt: string;
    workerName: string | null;
  };
}

export interface OverrideRequestRow {
  id: string;
  event_id: string;
  household_id: string;
  household_claim_code: string;
  aid_type_id: string;
  aid_type_name: string;
  allocation_attempt_id: string | null;
  requested_by_org_name: string;
  requested_by_name: string;
  reason: string;
  status: OverrideStatus;
  decided_by_name: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface AuditEventRow {
  id: string;
  audit_no: number;
  event_id: string;
  action: AuditAction;
  actor_name: string | null;
  actor_role: string | null;
  organization_name: string | null;
  household_claim_code: string | null;
  aid_type_name: string | null;
  detail: string;
  hash: string;
  created_at: string;
}

export interface StatsResponse {
  householdsHelped: number;
  duplicatesPrevented: number;
  partnerOrgs: number;
  totalAllocations: number;
  byAidType: { aidTypeName: string; icon: string; approved: number; denied: number }[];
  pendingOverrides: number;
  lowStock: { aidTypeName: string; icon: string; remaining: number; total: number }[];
  recentActivity: AuditEventRow[];
}
