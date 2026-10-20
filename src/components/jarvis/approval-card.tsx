"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalRequest } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useJarvisStore } from "@/lib/client/store";
import { toast } from "sonner";

export function ApprovalCard({
  approval,
  onResolved,
}: {
  approval: ApprovalRequest;
  onResolved: (approved: boolean) => void;
}) {
  const clearApproval = useJarvisStore((s) => s.clearApproval);
  const pushActivity = useJarvisStore((s) => s.pushActivity);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000))
  );

  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(t);
        clearApproval(approval.toolId);
        onResolved(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [approval.expiresAt, approval.toolId, clearApproval, onResolved]);

  const respond = async (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.approve(approval.approvalId, approved);
      pushActivity({
        kind: "approval",
        text: approved ? "Command approved" : "Command denied",
        detail: approval.command,
      });
      toast(approved ? "Command approved" : "Command denied", {
        description: approval.command.slice(0, 80),
      });
      clearApproval(approval.toolId);
      onResolved(approved);
    } catch {
      toast.error("Could not deliver the decision — try again");
      setBusy(false);
    }
  };

  const pct = Math.min(100, Math.max(0, (remaining / 180) * 100));

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 overflow-hidden relative">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-amber-400/90">
            Authorization required
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">{approval.reason}</p>
          <pre className="scrollbar-hud mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-amber-500/20 bg-black/40 px-2.5 py-2 font-mono text-[11px] text-amber-200/90">
            {approval.command}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => respond(true)}
              disabled={busy}
              className="h-9 bg-emerald-600/80 hover:bg-emerald-600 text-white"
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => respond(false)}
              disabled={busy}
              className="h-9 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              <X className="h-3.5 w-3.5" /> Deny
            </Button>
            <span className="ml-auto font-mono text-[10px] text-zinc-500">
              auto-deny in {remaining}s
            </span>
          </div>
        </div>
      </div>
      {/* countdown bar */}
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-amber-500/60 transition-[width] duration-1000 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
