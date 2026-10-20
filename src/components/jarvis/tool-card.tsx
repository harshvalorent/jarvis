"use client";

import { useState } from "react";
import {
  ChevronDown,
  Terminal,
  FolderOpen,
  FileText,
  FilePlus2,
  Globe,
  BookOpenText,
  Activity,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Ban,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCard as ToolCardType } from "@/lib/types";
import { TOOL_LABELS } from "@/lib/types";

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  run_command: Terminal,
  list_files: FolderOpen,
  read_file: FileText,
  write_file: FilePlus2,
  web_search: Globe,
  read_web_page: BookOpenText,
  system_info: Activity,
};

function argSummary(card: ToolCardType): string {
  switch (card.name) {
    case "run_command":
      return String(card.args.command ?? "").slice(0, 160);
    case "list_files":
      return String(card.args.path ?? "project folder");
    case "read_file":
      return String(card.args.path ?? "");
    case "write_file":
      return String(card.args.path ?? "");
    case "web_search":
      return String(card.args.query ?? "");
    case "read_web_page":
      return String(card.args.url ?? "");
    case "system_info":
      return "live telemetry";
    default:
      return JSON.stringify(card.args).slice(0, 120);
  }
}

const STATE_STYLES: Record<
  ToolCardType["state"],
  { border: string; icon: React.ReactNode; label: string }
> = {
  running: {
    border: "border-cyan-500/30",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />,
    label: "running",
  },
  awaiting_approval: {
    border: "border-amber-500/40",
    icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />,
    label: "awaiting approval",
  },
  done: {
    border: "border-emerald-500/20",
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    label: "complete",
  },
  error: {
    border: "border-red-500/30",
    icon: <XCircle className="h-3.5 w-3.5 text-red-400" />,
    label: "error",
  },
  denied: {
    border: "border-zinc-600/40",
    icon: <Ban className="h-3.5 w-3.5 text-zinc-500" />,
    label: "denied",
  },
  blocked: {
    border: "border-red-500/40",
    icon: <Ban className="h-3.5 w-3.5 text-red-500" />,
    label: "blocked",
  },
};

export function ToolCardView({ card }: { card: ToolCardType }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[card.name] ?? Activity;
  const state = STATE_STYLES[card.state];
  const hasResult = !!card.result;

  return (
    <div
      className={cn(
        "rounded-md border bg-[#060d18]/80 font-mono text-xs overflow-hidden transition-colors",
        state.border
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-cyan-500/5 transition-colors"
        aria-expanded={open}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
        <span className="shrink-0 uppercase tracking-wider text-cyan-300/80">
          {TOOL_LABELS[card.name] ?? card.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-zinc-400">{argSummary(card)}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {state.icon}
          <span className="hidden sm:inline text-[10px] text-zinc-500">
            {card.state === "done" && card.ms != null ? `${card.ms}ms` : state.label}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-zinc-500 transition-transform",
              open && "rotate-180"
            )}
          />
        </span>
      </button>
      {open && hasResult && (
        <div className="border-t border-zinc-800/60 bg-black/30">
          <pre className="scrollbar-hud max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300">
            {card.result}
          </pre>
        </div>
      )}
    </div>
  );
}
