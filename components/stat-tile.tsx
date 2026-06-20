import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2 text-ink-faint">
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold text-ink">{value ?? "—"}</div>
      </CardContent>
    </Card>
  );
}
