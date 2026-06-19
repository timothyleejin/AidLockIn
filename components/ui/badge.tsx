import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted border-border",
  primary: "bg-primary-tint text-primary border-primary-tint-strong",
  success: "bg-success-tint text-success border-success-border",
  warning: "bg-warning-tint text-warning border-warning-border",
  danger: "bg-danger-tint text-danger border-danger-border",
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  );
}
