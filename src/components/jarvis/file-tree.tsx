"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, File, FileCode2, FileJson, FileText, FolderClosed, FolderOpen, RefreshCw, Trash2, MessageSquare, Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useJarvisStore } from "@/lib/client/store";
import { HudFrame } from "@/components/jarvis/visuals/hud-frame";
import type { FileEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ROOT = "";

function fileIcon(name: string, open: boolean) {
  if (open) return FolderOpen;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py", "sh", "rs", "go", "java", "c", "cpp"].includes(ext)) return FileCode2;
  if (["json", "yaml", "yml", "toml", "lock"].includes(ext)) return FileJson;
  if (["md", "txt", "log", "csv"].includes(ext)) return FileText;
  return File;
}

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  onOpenFile: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onAsk: (entry: FileEntry) => void;
}

function TreeNode({ entry, depth, onOpenFile, onDelete, onAsk }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!entry.isDir) {
      onOpenFile(entry);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && !children) {
      setLoading(true);
      try {
        const res = await api.listFiles(entry.path);
        setChildren(res.entries.filter((e) => e.name !== "node_modules" && e.name !== ".git" && e.name !== ".next"));
      } catch {
        toast.error("Cannot open folder");
      } finally {
        setLoading(false);
      }
    }
  };

  const Icon = entry.isDir ? (open ? FolderOpen : FolderClosed) : fileIcon(entry.name, false);

  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-cyan-500/5"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {entry.isDir ? (
          <button
            type="button"
            onClick={toggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
            )}
            <Icon className={cn("h-3.5 w-3.5 shrink-0", entry.isDir ? "text-cyan-400/70" : "text-zinc-500")} />
            <span className="truncate font-mono text-[11px] text-zinc-300">{entry.name}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <span className="w-3 shrink-0" />
            <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="truncate font-mono text-[11px] text-zinc-300 group-hover:text-cyan-100">
              {entry.name}
            </span>
          </button>
        )}
        <span className="hidden items-center gap-0.5 group-hover:flex">
          <button
            type="button"
            onClick={() => onAsk(entry)}
            className="rounded p-1 text-zinc-500 hover:text-cyan-300"
            aria-label={`Ask JARVIS about ${entry.name}`}
            title="Ask JARVIS about this"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(entry)}
            className="rounded p-1 text-zinc-500 hover:text-red-400"
            aria-label={`Delete ${entry.name}`}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
      {entry.isDir && open && (
        <div>
          {loading ? (
            <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}>
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400/60" />
            </div>
          ) : (
            children?.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                onDelete={onDelete}
                onAsk={onAsk}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function FileTreePanel({ onAskJarvis }: { onAskJarvis: (text: string) => void }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [rootLabel, setRootLabel] = useState("project folder");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ path: string; content: string | null; binary?: boolean; truncated?: boolean; sizeLabel?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listFiles(ROOT);
      setRootLabel(res.path);
      setEntries(res.entries.filter((e) => e.name !== "node_modules" && e.name !== ".git" && e.name !== ".next"));
    } catch {
      toast.error("Cannot list files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openFile = async (entry: FileEntry) => {
    setPreviewLoading(true);
    setPreview({ path: entry.path, content: null });
    try {
      const res = await api.readFile(entry.path);
      setPreview(res);
    } catch {
      toast.error("Cannot read file");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const deleteEntry = async (entry: FileEntry) => {
    if (!window.confirm(`Delete ${entry.name}? This cannot be undone.`)) return;
    try {
      await api.fileAction("delete", entry.path);
      toast.success(`Deleted ${entry.name}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const ask = (entry: FileEntry) => {
    onAskJarvis(
      entry.isDir
        ? `Explore the directory ${entry.path} and tell me what's inside and what it does.`
        : `Read the file ${entry.path} and explain what it does.`
    );
  };

  return (
    <>
      <HudFrame
        title="Filesystem"
        className="p-2"
      >
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="truncate font-mono text-[9px] text-zinc-600">{rootLabel}</span>
          <button
            type="button"
            onClick={refresh}
            className="rounded p-1 text-zinc-500 hover:text-cyan-300"
            aria-label="Refresh file tree"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>
        <div className="scrollbar-hud max-h-[420px] overflow-y-auto">
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400/60" />
            </div>
          ) : (
            entries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                onOpenFile={openFile}
                onDelete={deleteEntry}
                onAsk={ask}
              />
            ))
          )}
        </div>
      </HudFrame>

      {/* File preview dialog */}
      {preview && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label="File preview"
        >
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-cyan-500/25 bg-[#060d18]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
              <p className="truncate font-mono text-xs text-cyan-300">{preview.path}</p>
              <div className="flex items-center gap-2">
                {preview.content && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-cyan-500/30 text-[10px]"
                    onClick={() => {
                      void navigator.clipboard.writeText(preview.content ?? "");
                      toast.success("Copied");
                    }}
                  >
                    Copy
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-cyan-500/30 text-[10px]"
                  onClick={() => {
                    ask({ name: preview.path.split("/").pop() ?? "file", path: preview.path, isDir: false, size: 0, mtime: 0 });
                    setPreview(null);
                  }}
                >
                  Ask JARVIS
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setPreview(null)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="scrollbar-hud min-h-0 flex-1 overflow-auto p-4">
              {previewLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-cyan-400/60" />
                </div>
              ) : preview.binary ? (
                <p className="py-8 text-center font-mono text-xs text-zinc-500">
                  Binary file — {preview.sizeLabel}
                </p>
              ) : preview.content ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                  {preview.content.slice(0, 100_000)}
                </pre>
              ) : preview.truncated ? (
                <p className="py-8 text-center font-mono text-xs text-zinc-500">
                  File too large to preview ({preview.sizeLabel}) — ask JARVIS to read parts of it.
                </p>
              ) : (
                <p className="py-8 text-center font-mono text-xs text-zinc-500">Empty file</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
