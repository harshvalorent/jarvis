"use client";

import { useJarvisStore } from "@/lib/client/store";
import { HudFrame } from "@/components/jarvis/visuals/hud-frame";
import { Trash2, Terminal, Globe, ShieldAlert, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/types";

const KIND_ICONS: Record<ActivityEntry["kind"], React.ComponentType<{ className?: string }>> = {
  tool: Terminal,
  approval: ShieldAlert,
  error: XCircle,
  info: Info,
};

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour12: false });
}

export function ActivityLogPanel() {
  const activity = useJarvisStore((s) => s.activity);
  const clearActivity = useJarvisStore((s) => s.clearActivity);

  return (
    <HudFrame title="Activity" className="p-2">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">
          {activity.length} events
        </span>
        <button
          type="button"
          onClick={clearActivity}
          className="rounded p-1 text-zinc-500 hover:text-red-400"
          aria-label="Clear activity log"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="scrollbar-hud max-h-[520px] space-y-0.5 overflow-y-auto">
        {activity.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-[10px] text-zinc-600">
            No activity yet. Give JARVIS a command.
          </p>
        ) : (
          activity.map((entry) => {
            const Icon = entry.kind === "tool" && entry.text.includes("web") ? Globe : KIND_ICONS[entry.kind];
            return (
              <div key={entry.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-cyan-500/5">
                <Icon
                  className={cn(
                    "mt-0.5 h-3 w-3 shrink-0",
                    entry.kind === "error"
                      ? "text-red-400"
                      : entry.kind === "approval"
                        ? "text-amber-400"
                        : entry.state === "running"
                          ? "text-cyan-400"
                          : entry.state === "denied" || entry.state === "blocked"
                            ? "text-zinc-500"
                            : entry.state === "error"
                              ? "text-red-400"
                              : "text-cyan-400/60"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[10px] text-zinc-300">
                    <span className="text-zinc-600">{timeLabel(entry.time)} </span>
                    {entry.text}
                  </p>
                  {entry.detail && (
                    <p className="truncate font-mono text-[9px] text-zinc-600">{entry.detail}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </HudFrame>
  );
}
