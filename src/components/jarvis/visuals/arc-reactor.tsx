"use client";

type ArcReactorProps = {
  /** Rendered width/height in px. All internals scale from a 200x200 viewBox. */
  size?: number;
  /** When false: dimmed (opacity-40), grayscale, all animations paused. */
  active?: boolean;
  /** Core glow strength, clamped to 0–1. */
  intensity?: number;
  className?: string;
};

/* Self-contained animation CSS. Longhand animation properties only, so the
   Tailwind `[animation-play-state:paused]` utility is never overridden. */
const ARC_CSS = `
@keyframes jarvis-arc-spin-outer {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes jarvis-arc-spin-mid {
  from { transform: rotate(0deg); }
  to { transform: rotate(-360deg); }
}
@keyframes jarvis-arc-pulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.05); opacity: 1; }
}
.jarvis-arc-spin-outer {
  animation-name: jarvis-arc-spin-outer;
  animation-duration: 14s;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  transform-origin: 100px 100px;
}
.jarvis-arc-spin-mid {
  animation-name: jarvis-arc-spin-mid;
  animation-duration: 9s;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  transform-origin: 100px 100px;
}
.jarvis-arc-pulse {
  animation-name: jarvis-arc-pulse;
  animation-duration: 2.4s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  transform-origin: 100px 100px;
}
@media (prefers-reduced-motion: reduce) {
  .jarvis-arc-spin-outer,
  .jarvis-arc-spin-mid,
  .jarvis-arc-pulse { animation-play-state: paused; }
}
`;

export function ArcReactor({ size = 160, active = true, intensity = 1, className }: ArcReactorProps) {
  // Gradient ids are STATIC and shared across instances: every instance defines
  // identical <defs>, so url(#…) always resolves to an identical gradient.
  // (useId produced different ids on server vs client → hydration mismatches.)
  const coreGradientId = "jarvis-arc-core";
  const glowGradientId = "jarvis-arc-glow";

  const t = Math.min(1, Math.max(0, intensity));
  const pauseCls = active ? "" : " [animation-play-state:paused]";

  // Layered cyan glow, scaled by intensity.
  const coreGlow = [
    `drop-shadow(0 0 ${(4 + 6 * t).toFixed(1)}px rgba(103, 232, 249, ${(0.55 * t).toFixed(3)}))`,
    `drop-shadow(0 0 ${(12 + 16 * t).toFixed(1)}px rgba(34, 211, 238, ${(0.38 * t).toFixed(3)}))`,
    `drop-shadow(0 0 ${(26 + 20 * t).toFixed(1)}px rgba(34, 211, 238, ${(0.2 * t).toFixed(3)}))`,
  ].join(" ");

  // Static chassis tick ring between the two rotating rings.
  // (rounded to 2 decimals so SSR and client serialize identical strings —
  // full-precision floats caused hydration attribute mismatches)
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = ((i * 15) / 180) * Math.PI;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
      x1: Math.round((100 + 67.5 * cos) * 100) / 100,
      y1: Math.round((100 + 67.5 * sin) * 100) / 100,
      x2: Math.round((100 + 71.5 * cos) * 100) / 100,
      y2: Math.round((100 + 71.5 * sin) * 100) / 100,
    };
  });

  // Screw positions (rounded for the same hydration reason)
  const screws = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = (deg / 180) * Math.PI;
    return {
      deg,
      cx: Math.round((100 + 94.5 * Math.cos(a)) * 100) / 100,
      cy: Math.round((100 + 94.5 * Math.sin(a)) * 100) / 100,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      style={{ display: "block" }}
      className={`${active ? "" : "opacity-40 grayscale "}${className ?? ""}`}
    >
      <style>{ARC_CSS}</style>

      <defs>
        <radialGradient id={coreGradientId}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="22%" stopColor="#f0feff" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#67e8f9" stopOpacity="0.85" />
          <stop offset="72%" stopColor="#22d3ee" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={glowGradientId}>
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.32" />
          <stop offset="55%" stopColor="#22d3ee" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Dark zinc housing */}
      <circle cx="100" cy="100" r="98" fill="#0b0d12" stroke="#27272a" strokeWidth="2" />
      <circle cx="100" cy="100" r="91" fill="#080a0f" stroke="#3f3f46" strokeWidth="0.8" opacity="0.9" />
      {screws.map((s) => (
        <circle key={s.deg} cx={s.cx} cy={s.cy} r="1.6" fill="#52525b" />
      ))}

      {/* Fixed tick ring */}
      <g stroke="#3f3f46" strokeWidth="1" opacity="0.5">
        {ticks.map((tk, i) => (
          <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} />
        ))}
      </g>

      {/* Rotating segmented outer ring — 12 segments, 14s clockwise */}
      <g className={`jarvis-arc-spin-outer${pauseCls}`}>
        <circle cx="100" cy="100" r="79" fill="none" stroke="#164e63" strokeWidth="4" opacity="0.3" />
        <circle
          cx="100"
          cy="100"
          r="79"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="4"
          strokeDasharray="26 15.36"
          opacity="0.55"
        />
      </g>

      {/* Counter-rotating middle ring — 8 segments, 9s counter-clockwise */}
      <g className={`jarvis-arc-spin-mid${pauseCls}`}>
        <circle cx="100" cy="100" r="61" fill="none" stroke="#155e75" strokeWidth="3" opacity="0.3" />
        <circle
          cx="100"
          cy="100"
          r="61"
          fill="none"
          stroke="#67e8f9"
          strokeWidth="3"
          strokeDasharray="30 17.91"
          opacity="0.6"
        />
      </g>

      {/* Inner coil / triangle hint */}
      <g opacity="0.55">
        <polygon
          points="100,70 126,115 74,115"
          fill="none"
          stroke="#a5f3fc"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="100" cy="70" r="2" fill="#67e8f9" />
        <circle cx="126" cy="115" r="2" fill="#67e8f9" />
        <circle cx="74" cy="115" r="2" fill="#67e8f9" />
      </g>

      {/* Glowing core */}
      <g className={`jarvis-arc-pulse${pauseCls}`} style={{ filter: coreGlow }}>
        <circle cx="100" cy="100" r="50" fill={`url(#${glowGradientId})`} />
        <circle cx="100" cy="100" r="37" fill={`url(#${coreGradientId})`} />
        <circle cx="100" cy="100" r="9" fill="#ffffff" opacity={0.55 + 0.45 * t} />
      </g>
    </svg>
  );
}
