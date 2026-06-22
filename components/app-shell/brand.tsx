"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

/**
 * Renders the AidLockIn logo from /public/aidlockin-logo.png. If that asset
 * isn't present yet, it falls back to the original shield mark + wordmark so
 * the app never shows a broken image — drop the PNG in and it upgrades
 * automatically with no code change.
 */
export function BrandLogo({ variant = "sidebar" }: { variant?: "sidebar" | "hero" }) {
  const [ok, setOk] = useState(true);
  const sizeClass = variant === "hero" ? "h-20 w-auto" : "h-12 w-auto";

  if (!ok) {
    if (variant === "hero") return null;
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-ink">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="text-[15px] font-semibold leading-none text-ink">AidLockIn</div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/aidlockin-logo.png"
      alt="AidLockIn"
      className={sizeClass}
      onError={() => setOk(false)}
    />
  );
}
