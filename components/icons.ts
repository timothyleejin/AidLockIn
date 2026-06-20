import {
  Package,
  Banknote,
  Syringe,
  BedDouble,
  Bus,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

/** Maps the `icon` string stored on aid_types to an actual component. */
export const AID_TYPE_ICONS: Record<string, LucideIcon> = {
  package: Package,
  banknote: Banknote,
  syringe: Syringe,
  "bed-double": BedDouble,
  bus: Bus,
};

export function getAidTypeIcon(key: string): LucideIcon {
  return AID_TYPE_ICONS[key] ?? HelpCircle;
}

/** Options offered on the "New aid type" form. */
export const AID_TYPE_ICON_OPTIONS: { key: string; label: string }[] = [
  { key: "package", label: "Food / supplies" },
  { key: "banknote", label: "Cash" },
  { key: "syringe", label: "Medicine" },
  { key: "bed-double", label: "Shelter" },
  { key: "bus", label: "Transport" },
];
