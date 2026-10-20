"use client";

import { useEffect, useState } from "react";
import { useJarvisStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Sidebar } from "@/components/jarvis/sidebar";
import { ArcReactor } from "@/components/jarvis/visuals/arc-reactor";
import { ChatPanel } from "@/components/jarvis/chat-panel";
import { SettingsDialog } from "@/components/jarvis/settings-dialog";
import { Scanlines } from "@/components/jarvis/visuals/scanlines";
import { BootSequence } from "@/components/jarvis/visuals/boot-sequence";
import { History, PanelLeftOpen, Plus, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SessionList } from "@/components/jarvis/session-list";

export function JarvisApp() {
  const booted = useJarvisStore((s) => s.booted);
  const setBooted = useJarvisStore((s) => s.setBooted);
  const loadSettings = useJarvisStore((s) => s.loadSettings);
  const loadSessions = useJarvisStore((s) => s.loadSessions);
  const loadAiConfig = useJarvisStore((s) => s.loadAiConfig);
  const sidebarOpen = useJarvisStore((s) => s.sidebarOpen);
  const setSidebarOpen = useJarvisStore((s) => s.setSidebarOpen);
  const streaming = useJarvisStore((s) => s.streaming);
  const voiceState = useJarvisStore((s) => s.voiceState);

  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    void loadSettings();
    void loadSessions();
    void loadAiConfig();
  }, [loadSettings, loadSessions, loadAiConfig]);

  const reactorActive = booted;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#04070d] text-zinc-100">
      {!booted && <BootSequence onComplete={() => setBooted(true)} />}
      <Scanlines />

      {/* Header */}
      <header className="relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-cyan-500/10 bg-[#050b16]/80 px-3 backdrop-blur-md sm:px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan-500/20 text-cyan-400/80 transition-colors hover:border-cyan-400/50 hover:text-cyan-300 lg:hidden"
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <X className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>

        <div className="flex items-center gap-3">
          <ArcReactor size={30} active={reactorActive} intensity={streaming || voiceState !== "idle" ? 1 : 0.6} />
          <div className="leading-tight">
            <h1 className="text-glow font-mono text-sm tracking-[0.35em] text-cyan-100">
              J.A.R.V.I.S.
            </h1>
            <p className="hidden font-mono text-[8px] tracking-[0.25em] text-zinc-600 sm:block">
              MARK II · HOME OS
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest md:inline-flex ${
              streaming || voiceState === "thinking"
                ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-300"
                : "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                streaming || voiceState === "thinking"
                  ? "animate-pulse bg-cyan-400"
                  : "bg-emerald-400"
              }`}
            />
            {streaming || voiceState === "thinking" ? "Active" : "Online"}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            className="h-9 gap-1.5 border-cyan-500/20 bg-[#081120] font-mono text-[10px] uppercase tracking-widest text-cyan-300/80 hover:border-cyan-400/40 hover:text-cyan-200"
            aria-label="Session history"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">History</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => useJarvisStore.getState().newChat()}
            className="h-9 gap-1.5 border-cyan-500/20 bg-[#081120] font-mono text-[10px] uppercase tracking-widest text-cyan-300/80 hover:border-cyan-400/40 hover:text-cyan-200"
            aria-label="New session"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => useJarvisStore.getState().setSettingsOpen(true)}
            className="h-9 w-9 border-cyan-500/20 bg-[#081120] p-0 text-cyan-300/80 hover:border-cyan-400/40 hover:text-cyan-200"
            aria-label="Settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-[340px] shrink-0 border-r border-cyan-500/10 bg-[#050b16]/60 lg:block">
          <Sidebar />
        </aside>

        {/* Mobile sidebar */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-[85vw] max-w-[340px] border-r border-cyan-500/20 bg-[#050b16] shadow-2xl">
              <div className="flex h-14 items-center justify-between border-b border-cyan-500/10 px-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-300/80">
                  Systems
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-md p-1.5 text-zinc-400 hover:text-cyan-300"
                  aria-label="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="h-[calc(100%-3.5rem)]">
                <Sidebar />
              </div>
            </div>
          </div>
        )}

        {/* Chat */}
        <main className="min-w-0 flex-1">
          <ChatPanel />
        </main>
      </div>

      {/* History sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="left"
          className="w-[85vw] max-w-[380px] overflow-y-auto border-cyan-500/20 bg-[#050b16] p-0"
        >
          <SheetHeader className="border-b border-cyan-500/10 px-4 py-3">
            <SheetTitle className="font-mono text-xs uppercase tracking-[0.3em] text-cyan-200">
              Session History
            </SheetTitle>
            <SheetDescription className="font-mono text-[10px] text-zinc-500">
              Past conversations with JARVIS
            </SheetDescription>
          </SheetHeader>
          <div className="p-3">
            <SessionList
              onPicked={() => setHistoryOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsDialog />
    </div>
  );
}
