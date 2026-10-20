"use client";

import type { ReactNode } from "react";

type HudFrameProps = {
  children: ReactNode;
  title?: string;
  accent?: "cyan" | "amber";
  className?: string;
};

export function HudFrame({ children, title, accent = "cyan", className }: HudFrameProps) {
  const isAmber = accent === "amber";
  const border = isAmber ? "border-amber-500/15" : "border-cyan-500/15";
  const bracket = isAmber ? "border-amber-400/60" : "border-cyan-400/60";
  const titleColor = isAmber ? "text-amber-300/70" : "text-cyan-300/70";
  const bullet = isAmber ? "bg-amber-400/70" : "bg-cyan-400/70";
  const innerGlow = isAmber
    ? "shadow-[inset_0_0_28px_rgba(245,158,11,0.05)]"
    : "shadow-[inset_0_0_28px_rgba(34,211,238,0.05)]";

  return (
    <div
      className={`relative rounded-md border bg-[#081120]/70 backdrop-blur-md ${border} ${innerGlow}${
        className ? ` ${className}` : ""
      }`}
    >
      {/* Exactly 4 corner brackets: 10px legs, 1.5px thick */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-[-2px] top-[-2px] h-[10px] w-[10px] border-l-[1.5px] border-t-[1.5px] ${bracket}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-[-2px] top-[-2px] h-[10px] w-[10px] border-r-[1.5px] border-t-[1.5px] ${bracket}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-[-2px] left-[-2px] h-[10px] w-[10px] border-b-[1.5px] border-l-[1.5px] ${bracket}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-[-2px] right-[-2px] h-[10px] w-[10px] border-b-[1.5px] border-r-[1.5px] ${bracket}`}
      />

      {/* Optional title — overlaps and cuts the top border */}
      {title ? (
        <div className="absolute left-3 top-0 -mt-2 flex items-center gap-2 bg-[#04070d] px-2">
          <span aria-hidden="true" className={`h-1 w-1 ${bullet}`} />
          <span className={`font-mono text-[10px] uppercase tracking-[0.25em] ${titleColor}`}>{title}</span>
          <span aria-hidden="true" className={`h-1 w-1 ${bullet}`} />
        </div>
      ) : null}

      {children}
    </div>
  );
}
