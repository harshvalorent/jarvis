"use client";

import { useEffect } from "react";
import { Power, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Global client-side error boundary. Any uncaught render error in the page
 * tree lands here — showing a recoverable HUD panel instead of the default
 * white "Application error" screen. reset() re-renders the route.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the full error in the browser console for diagnosis.
    console.error("[JARVIS] Client error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#04070d] p-4">
      <div className="w-full max-w-md rounded-lg border border-amber-500/25 bg-[#081120]/80 p-6 text-center shadow-[0_0_24px_rgba(245,158,11,0.08)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
          <TriangleAlert className="h-6 w-6 text-amber-400" aria-hidden="true" />
        </div>
        <h1 className="font-mono text-sm uppercase tracking-[0.3em] text-amber-300">
          System fault detected
        </h1>
        <p className="mt-2 font-mono text-[10px] text-zinc-500">
          J.A.R.V.I.S. encountered an interface error. The core systems are
          unaffected — reboot the interface to continue.
        </p>
        <div className="mt-4 max-h-24 overflow-y-auto scrollbar-hud rounded border border-zinc-800 bg-[#04070d] p-3 text-left">
          <code className="font-mono text-[10px] break-words text-zinc-400">
            {error.message || "Unknown client-side error"}
          </code>
        </div>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            onClick={reset}
            className="h-9 gap-2 bg-amber-500/20 font-mono text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/30"
          >
            <Power className="h-3.5 w-3.5" aria-hidden="true" /> Reboot interface
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="h-9 gap-2 border-zinc-700 font-mono text-[10px] uppercase tracking-widest text-zinc-400"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}
