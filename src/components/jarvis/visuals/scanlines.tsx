"use client";

const SCAN_CSS = `
@keyframes jarvis-scan-sweep {
  from { transform: translateY(-10vh); }
  to { transform: translateY(100vh); }
}
.jarvis-scan-sweep {
  animation-name: jarvis-scan-sweep;
  animation-duration: 9s;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .jarvis-scan-sweep { animation: none; }
}
`;

type ScanlinesProps = {
  className?: string;
};

export function Scanlines({ className }: ScanlinesProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-[90] overflow-hidden${
        className ? ` ${className}` : ""
      }`}
    >
      <style>{SCAN_CSS}</style>

      {/* (a) Horizontal scanlines — 1px cyan lines every 3px */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(to bottom, rgba(34, 211, 238, 0.025) 0px, rgba(34, 211, 238, 0.025) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* (b) Subtle vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 52%, rgba(2, 6, 12, 0.5) 100%)",
        }}
      />

      {/* (c) Slow vertical scan sweep */}
      <div
        className="jarvis-scan-sweep absolute inset-x-0 top-0 h-[10vh]"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(34, 211, 238, 0.05) 50%, transparent 100%)",
        }}
      />
    </div>
  );
}
