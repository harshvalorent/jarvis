"use client";

import { useEffect, useRef } from "react";

type WaveformProps = {
  state?: "idle" | "listening" | "speaking" | "thinking";
  bars?: number;
  height?: number;
  className?: string;
};

export function Waveform({ state = "idle", bars = 28, height = 36, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Shared clock so restarting the loop (state/prop changes) keeps phase continuity.
  const t0Ref = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement;
    const cssHeight = Math.max(8, height);
    const barCount = Math.max(1, Math.floor(bars));

    if (t0Ref.current === 0) t0Ref.current = performance.now();
    const t0 = t0Ref.current;

    let rafId = 0;
    let cssWidth = 0;
    let dpr = 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      cssWidth = Math.max(0, canvas.getBoundingClientRect().width);
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.height = `${cssHeight}px`;
    };
    resize();

    // Observe the parent so width changes redraw at the correct size.
    const observer = new ResizeObserver(() => resize());
    observer.observe(parent ?? canvas);

    // Smoothed per-bar values (used by the "listening" jitter).
    const values = new Array<number>(barCount).fill(0.12);

    const drawBar = (x: number, y: number, w: number, h: number) => {
      const r = Math.min(2, w / 2, h / 2);
      if (r < 0.75) {
        ctx.fillRect(x, y, w, h);
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
    };

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      const t = (now - t0) / 1000;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      if (cssWidth < 4) return;

      const slot = cssWidth / barCount;
      const barWidth = Math.max(2, slot * 0.58);
      const cy = cssHeight / 2;
      const half = (barCount - 1) / 2;

      for (let i = 0; i < barCount; i++) {
        const x = i * slot + (slot - barWidth) / 2;
        // Slight alpha falloff from the center outward.
        const dist = half > 0 ? Math.abs(i - half) / half : 0;
        const alpha = 0.3 + 0.7 * (1 - dist);

        if (state === "idle") {
          // Tiny static 2px dots.
          ctx.fillStyle = `rgba(34, 211, 238, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x + barWidth / 2, cy, 1, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        let barHeight: number;
        if (state === "listening") {
          // Calm, smoothly travelling wave with gentle amplitude drift —
          // deliberately NOT random jitter (that read as "uncontrolled").
          const base =
            0.42 * Math.sin(t * 1.6 + i * 0.5) +
            0.28 * Math.sin(t * 2.3 + i * 0.9 + 2.1) +
            0.18 * Math.sin(t * 0.9 - i * 0.4);
          const envelope = 0.62 + 0.38 * Math.sin(t * 0.55 + i * 0.18);
          const target = 0.16 + Math.abs(base) * envelope * 0.55;
          values[i] += (target - values[i]) * 0.12;
          barHeight = Math.max(3, Math.min(cssHeight * 0.72, values[i] * cssHeight));
        } else if (state === "speaking") {
          // Smooth layered sinusoidal motion.
          const v =
            0.5 * Math.sin(t * 2.4 + i * 0.55) +
            0.32 * Math.sin(t * 3.7 + i * 1.15 + 1.4) +
            0.18 * Math.sin(t * 1.1 - i * 0.35 + 0.6);
          const envelope = 0.55 + 0.45 * Math.sin(t * 0.8 + 0.4); // speech cadence
          barHeight = Math.max(3, Math.abs(v) * envelope * cssHeight);
        } else {
          // thinking — slow gentle breathing pulse.
          const breathe = 0.35 + 0.3 * Math.sin(t * 0.85);
          const shape = 0.45 + 0.55 * Math.sin(i * 0.65 + t * 0.5);
          barHeight = Math.max(3, breathe * shape * cssHeight);
        }

        ctx.fillStyle = `rgba(34, 211, 238, ${alpha.toFixed(3)})`;
        drawBar(x, cy - barHeight / 2, barWidth, barHeight);
      }
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [state, bars, height]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ width: "100%", height, display: "block" }}
    />
  );
}
