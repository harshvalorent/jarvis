"use client";

import { useEffect } from "react";
import { useJarvisStore } from "@/lib/client/store";
import { GaugeRing } from "@/components/jarvis/visuals/gauge-ring";
import { HudFrame } from "@/components/jarvis/visuals/hud-frame";
import { Activity, Clock, HardDrive, Cpu, MemoryStick, Wifi, Layers, Eye, ShieldCheck } from "lucide-react";

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

export function SystemPanel() {
  const stats = useJarvisStore((s) => s.stats);
  const loadStats = useJarvisStore((s) => s.loadStats);
  const settings = useJarvisStore((s) => s.settings);
  const lastLatencyMs = useJarvisStore((s) => s.lastLatencyMs);

  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 4000);
    return () => clearInterval(t);
  }, [loadStats]);

  return (
    <div className="space-y-3">
      <HudFrame title="Telemetry" className="p-4">
        <div className="grid grid-cols-3 gap-1">
          <GaugeRing value={stats?.cpuUsage ?? 0} label="CPU" size={76} />
          <GaugeRing value={stats?.memPct ?? 0} label="MEM" size={76} />
          <GaugeRing value={stats?.diskPct ?? 0} label="DISK" size={76} />
        </div>
        <p className="mt-2 truncate text-center font-mono text-[9px] text-zinc-600">
          {stats?.cpuModel ?? "…"}
        </p>
      </HudFrame>

      <HudFrame title="Machine" className="p-0">
        <dl className="divide-y divide-zinc-800/60 font-mono text-[11px]">
          <Row icon={<Cpu className="h-3 w-3" />} k="Host" v={stats?.hostname ?? "…"} />
          <Row icon={<Layers className="h-3 w-3" />} k="OS" v={stats ? `${stats.platform} ${stats.arch}` : "…"} />
          <Row
            icon={<MemoryStick className="h-3 w-3" />}
            k="Memory"
            v={stats ? `${fmtBytes(stats.memUsed)} / ${fmtBytes(stats.memTotal)}` : "…"}
          />
          <Row
            icon={<HardDrive className="h-3 w-3" />}
            k="Disk"
            v={stats ? `${fmtBytes(stats.diskUsed)} / ${fmtBytes(stats.diskTotal)}` : "…"}
          />
          <Row icon={<Clock className="h-3 w-3" />} k="Uptime" v={stats ? fmtUptime(stats.uptime) : "…"} />
          <Row icon={<Wifi className="h-3 w-3" />} k="IP" v={stats?.ip ?? "…"} />
          <Row icon={<Activity className="h-3 w-3" />} k="Processes" v={stats ? String(stats.processes) : "…"} />
          <Row icon={<Activity className="h-3 w-3" />} k="Load" v={stats ? stats.loadAvg.map((l) => l.toFixed(2)).join(" ") : "…"} />
        </dl>
      </HudFrame>

      <HudFrame title="Neural Link" className="p-0">
        <dl className="divide-y divide-zinc-800/60 font-mono text-[11px]">
          <Row
            icon={<Activity className="h-3 w-3" />}
            k="Core"
            v={
              settings
                ? settings.reasoningMode === "ultra"
                  ? "JARVIS · ultra"
                  : settings.reasoningMode === "deep"
                    ? "JARVIS · deep"
                    : "JARVIS · fast"
                : "…"
            }
          />
          <Row
            icon={<Eye className="h-3 w-3" />}
            k="Vision"
            v="multimodal online"
          />
          <Row
            icon={<ShieldCheck className="h-3 w-3" />}
            k="Safety"
            v={settings ? settings.safetyLevel : "…"}
          />
          <Row
            icon={<Clock className="h-3 w-3" />}
            k="Latency"
            v={lastLatencyMs != null ? `${(lastLatencyMs / 1000).toFixed(1)}s` : "—"}
          />
        </dl>
      </HudFrame>
    </div>
  );
}

function Row({
  icon,
  k,
  v,
}: {
  icon: React.ReactNode;
  k: string;
  v: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-cyan-400/50">{icon}</span>
      <dt className="w-24 shrink-0 text-zinc-500">{k}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-zinc-300">{v}</dd>
    </div>
  );
}
