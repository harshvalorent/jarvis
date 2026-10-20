"use client";

import { useEffect, useMemo, useState } from "react";
import { useJarvisStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2, Clock, Pencil, Check, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function SessionList({ onPicked }: { onPicked?: () => void }) {
  const sessions = useJarvisStore((s) => s.sessions);
  const activeSessionId = useJarvisStore((s) => s.activeSessionId);
  const loadSessions = useJarvisStore((s) => s.loadSessions);
  const loadSessionMessages = useJarvisStore((s) => s.loadSessionMessages);
  const deleteSession = useJarvisStore((s) => s.deleteSession);

  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.preview ?? "").toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const commitRename = async (id: string) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title) return;
    try {
      await api.renameSession(id, title);
      await loadSessions();
      toast.success("Session renamed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="h-9 w-full rounded-md border border-cyan-500/20 bg-[#081120] pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-cyan-400/50"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center font-mono text-[11px] text-zinc-600">
          {query ? "No matching conversations." : "No sessions yet — say something to JARVIS."}
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.map((s) => {
            const renaming = renamingId === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  "group rounded-md border px-3 py-2.5 transition-colors",
                  s.id === activeSessionId
                    ? "border-cyan-400/40 bg-cyan-500/10"
                    : "border-zinc-800/60 bg-[#081120]/50 hover:border-cyan-500/25 hover:bg-cyan-500/5"
                )}
              >
                {renaming ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(s.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      autoFocus
                      maxLength={80}
                      aria-label="Rename session"
                      className="h-8 min-w-0 flex-1 rounded border border-cyan-400/40 bg-[#0a1626] px-2 text-xs text-zinc-100 outline-none focus:border-cyan-300"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename(s.id)}
                      className="rounded p-1.5 text-emerald-400 hover:bg-emerald-500/10"
                      aria-label="Confirm rename"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="rounded p-1.5 text-zinc-500 hover:text-zinc-300"
                      aria-label="Cancel rename"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={async () => {
                        try {
                          await loadSessionMessages(s.id);
                          onPicked?.();
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      <p className="truncate text-xs text-zinc-200 group-hover:text-cyan-100">
                        {s.title}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-zinc-600">
                        <Clock className="h-2.5 w-2.5" />
                        {relative(s.updatedAt)}
                        <span>· {s.messageCount} msg</span>
                      </p>
                      {s.preview && (
                        <p className="mt-0.5 truncate font-mono text-[9px] text-zinc-600">
                          {s.preview}
                        </p>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(s.id);
                          setRenameDraft(s.title);
                        }}
                        className="rounded p-1 text-zinc-500 hover:text-cyan-300"
                        aria-label={`Rename session ${s.title}`}
                        title="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete "${s.title}"? This cannot be undone.`)) {
                            void deleteSession(s.id);
                          }
                        }}
                        className="rounded p-1 text-zinc-500 hover:text-red-400"
                        aria-label={`Delete session ${s.title}`}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full gap-1.5 border-cyan-500/20 font-mono text-[10px] uppercase tracking-widest text-cyan-300/80 hover:border-cyan-400/40 hover:text-cyan-200"
        onClick={() => {
          useJarvisStore.getState().newChat();
          onPicked?.();
        }}
      >
        <MessageSquare className="h-3 w-3" /> New session
      </Button>
    </div>
  );
}
