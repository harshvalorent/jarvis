"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArcReactor } from "./arc-reactor";

const BOOT_LINES = [
  "INITIALIZING NEURAL CORE",
  "LOADING COGNITIVE MODULES",
  "MOUNTING FILESYSTEM ACCESS",
  "ESTABLISHING NETWORK UPLINK",
  "CALIBRATING VOICE MATRIX",
  "SYNCING SYSTEM TELEMETRY",
  "ALL SYSTEMS NOMINAL",
];

const BOOT_CSS = `
@keyframes jarvis-boot-rise {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes jarvis-boot-wordmark {
  from { opacity: 0; letter-spacing: 0.85em; }
  to { opacity: 1; letter-spacing: 0.5em; }
}
@keyframes jarvis-boot-line-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes jarvis-boot-ok-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes jarvis-boot-progress {
  from { width: 0%; }
  to { width: 100%; }
}
@keyframes jarvis-boot-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
.jarvis-boot-rise {
  animation: jarvis-boot-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.jarvis-boot-wordmark {
  animation: jarvis-boot-wordmark 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.jarvis-boot-line {
  opacity: 0;
  animation: jarvis-boot-line-in 360ms ease-out both;
}
.jarvis-boot-ok {
  opacity: 0;
  animation: jarvis-boot-ok-in 320ms ease-out both;
}
.jarvis-boot-progress-fill {
  width: 0%;
  animation-name: jarvis-boot-progress;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
.jarvis-boot-fade {
  animation-name: jarvis-boot-fade-out;
  animation-duration: 350ms;
  animation-timing-function: ease-out;
  animation-fill-mode: forwards;
}
`;

type BootSequenceProps = {
  onComplete: () => void;
  /** Total boot duration in ms (default 3400). */
  duration?: number;
};

export function BootSequence({ onComplete, duration = 3400 }: BootSequenceProps) {
  const [progress, setProgress] = useState(0);
  const [fading, setFading] = useState(false);
  const [fadeMs, setFadeMs] = useState(350);

  const doneRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  /** Trigger the fade-out, then fire onComplete exactly once. */
  const finish = useCallback((ms: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFadeMs(ms);
    setFading(true);
    timersRef.current.push(window.setTimeout(() => onCompleteRef.current(), ms));
  }, []);

  /** Click anywhere / press any key → skip immediately (quick 180ms fade). */
  const skip = useCallback(() => finish(180), [finish]);

  useEffect(() => {
    const startedAt = performance.now();

    const progressTimer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setProgress(Math.min(100, Math.floor((elapsed / duration) * 100)));
    }, 64);

    const endTimer = window.setTimeout(() => finish(350), duration);

    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(endTimer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    };
  }, [duration, finish, skip]);

  // Log lines all appear within the first ~75% of the duration.
  const lineWindow = duration * 0.75;
  const lineStep = Math.max(70, (lineWindow - 700) / (BOOT_LINES.length - 1));
  const firstLineDelay = Math.min(240, duration * 0.1);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#04070d]${
        fading ? " jarvis-boot-fade pointer-events-none" : ""
      }`}
      style={fading ? { animationDuration: `${fadeMs}ms` } : undefined}
    >
      <style>{BOOT_CSS}</style>

      {/* Faint radial cyan glow at center */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 55% at 50% 44%, rgba(34, 211, 238, 0.08) 0%, rgba(34, 211, 238, 0.02) 45%, transparent 72%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6 py-10">
        <div className="jarvis-boot-rise">
          <ArcReactor size={150} />
        </div>

        <h1
          className="jarvis-boot-wordmark mt-6 pl-[0.5em] text-[22px] font-medium uppercase tracking-[0.5em] text-cyan-100"
          style={{ textShadow: "0 0 14px rgba(34, 211, 238, 0.55), 0 0 42px rgba(34, 211, 238, 0.28)" }}
        >
          J.A.R.V.I.S.
        </h1>

        <p className="mt-3 pl-[0.3em] text-[9px] uppercase tracking-[0.3em] text-zinc-500">
          JUST A RATHER VERY INTELLIGENT SYSTEM
        </p>

        <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-cyan-400/60">
          MARK II — SYSTEM ONLINE
        </p>

        {/* Boot log */}
        <div className="mt-8 flex flex-col items-center gap-[5px]">
          {BOOT_LINES.map((line, i) => {
            const delay = firstLineDelay + lineStep * i;
            return (
              <div
                key={line}
                className="jarvis-boot-line font-mono text-[11px] leading-[1.4] text-zinc-400"
                style={{ animationDelay: `${delay}ms` }}
              >
                <span className="mr-1.5 text-zinc-600">{"»"}</span>
                {line}
                <span
                  className="jarvis-boot-ok ml-2 text-cyan-400"
                  style={{ animationDelay: `${delay + 320}ms` }}
                >
                  {"… OK"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="mx-auto mt-9 w-64">
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="jarvis-boot-progress-fill h-full rounded-full bg-cyan-400"
              style={{
                animationDuration: `${duration}ms`,
                boxShadow: "0 0 8px rgba(34, 211, 238, 0.6), 0 0 2px rgba(34, 211, 238, 0.9)",
              }}
            />
          </div>
          <p className="mt-2 text-center font-mono text-[9px] tracking-[0.25em] text-zinc-500">
            BOOT SEQUENCE <span className="text-cyan-400/80">{String(progress).padStart(2, "0")}%</span>
          </p>
        </div>
      </div>
    </div>
  );
}
