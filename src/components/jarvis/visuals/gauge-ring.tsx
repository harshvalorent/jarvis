"use client";

import { useEffect, useState } from "react";

type GaugeRingProps = {
  /** Percentage 0–100 (clamped). */
  value: number;
  label: string;
  sublabel?: string;
  size?: number;
  className?: string;
};

const ARC_LENGTH = 75; // 270° of a pathLength-normalized (100) circle
const ROTATION_DEG = 135; // arc starts at 135°, leaving a gap at the bottom

export function GaugeRing({ value, label, sublabel, size = 84, className }: GaugeRingProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(100, Math.max(0, safeValue));
  const display = Math.round(clamped);
  const color = clamped < 60 ? "#22d3ee" : clamped < 85 ? "#f59e0b" : "#ef4444";

  // Arm after mount so the arc animates in from empty (stroke-dashoffset transition).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setArmed(true), 30);
    return () => window.clearTimeout(id);
  }, []);

  const strokeWidth = Math.max(4, size * 0.08);
  const c = size / 2;
  const r = c - strokeWidth / 2 - 1;
  const dashOffset = armed ? ARC_LENGTH * (1 - clamped / 100) : ARC_LENGTH;

  return (
    <div
      role="img"
      aria-label={`${label}: ${display}%`}
      className={`relative inline-block ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        {/* Track */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="#27272a"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${ARC_LENGTH} 100`}
          transform={`rotate(${ROTATION_DEG} ${c} ${c})`}
        />
        {/* Progress */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${ARC_LENGTH} 100`}
          strokeDashoffset={dashOffset}
          transform={`rotate(${ROTATION_DEG} ${c} ${c})`}
          style={{
            transition: "stroke-dashoffset 700ms ease-out, stroke 400ms ease-out, filter 400ms ease-out",
            filter: `drop-shadow(0 0 3px ${color}66) drop-shadow(0 0 8px ${color}33)`,
          }}
        />
      </svg>

      {/* Center readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-baseline">
          <span className="font-mono text-lg font-semibold leading-none text-zinc-100">{display}</span>
          <span className="ml-0.5 font-mono text-[9px] text-zinc-500">%</span>
        </div>
        <span className="mt-1 max-w-full truncate px-1 text-[9px] uppercase tracking-widest text-zinc-500">
          {label}
        </span>
        {sublabel ? (
          <span className="mt-0.5 max-w-full truncate px-1 text-[8px] uppercase tracking-wider text-zinc-600">
            {sublabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
