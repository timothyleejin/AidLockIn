import {
  CalendarPlus,
  PackagePlus,
  CircleCheck,
  ShieldAlert,
  TriangleAlert,
  Zap,
  HelpCircle,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import type { AuditAction } from "@/lib/types";

interface ActionMeta {
  label: string;
  icon: LucideIcon;
  tone: "neutral" | "primary" | "success" | "warning" | "danger";
}

export const ACTION_META: Record<AuditAction, ActionMeta> = {
  EVENT_CREATED: { label: "Event opened", icon: CalendarPlus, tone: "primary" },
  AID_TYPE_CREATED: { label: "Aid type added", icon: PackagePlus, tone: "primary" },
  ALLOCATION_APPROVED: { label: "Allocated", icon: CircleCheck, tone: "success" },
  ALLOCATION_DENIED_DUPLICATE: { label: "Duplicate blocked", icon: ShieldAlert, tone: "danger" },
  ALLOCATION_DENIED_NO_STOCK: { label: "Out of stock", icon: TriangleAlert, tone: "warning" },
  ALLOCATION_DENIED_RESOURCE_TAKEN: { label: "Just taken", icon: Zap, tone: "warning" },
  OVERRIDE_REQUESTED: { label: "Override requested", icon: HelpCircle, tone: "primary" },
  OVERRIDE_APPROVED: { label: "Override approved", icon: CircleCheck, tone: "success" },
  OVERRIDE_REJECTED: { label: "Override rejected", icon: CircleX, tone: "danger" },
};

/**
 * Tailwind v4 statically scans source text for class names — a template
 * literal like `bg-${tone}-tint` never produces real CSS because the
 * scanner can't see the interpolated result. These lookup maps spell every
 * class out in full so the scanner finds them, while call sites still get
 * to branch on a plain string key.
 */
export const TONE_ICON_BG: Record<ActionMeta["tone"], string> = {
  neutral: "bg-surface-muted",
  primary: "bg-primary-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
};

export const TONE_ICON_TEXT: Record<ActionMeta["tone"], string> = {
  neutral: "text-ink-muted",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};
