"use client";

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Copy,
  Check,
  User,
  Pencil,
  RefreshCw,
  X,
  CornerDownLeft,
  FileText,
  Music,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMsg } from "@/lib/types";
import { ToolCardView } from "@/components/jarvis/tool-card";
import { ArcReactor } from "@/components/jarvis/visuals/arc-reactor";

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          img: (props) => (
            <img
              {...props}
              alt={props.alt ?? "AI generated image"}
              loading="lazy"
              className="my-2 max-w-full rounded-lg border border-cyan-500/20 shadow-[0_0_16px_rgba(34,211,238,0.08)]"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export interface MessageItemProps {
  message: ChatMsg;
  /** true while a response is being generated (disables actions) */
  busy?: boolean;
  onEditUser?: (messageId: string, newText: string) => void;
  onRegenerate?: (assistantMsgId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  busy = false,
  onEditUser,
  onRegenerate,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const isUser = message.role === "user";

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(draft.length, draft.length);
    }
  }, [editing, draft.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  // ── User message (with inline edit + attached images) ─────────────────────
  if (isUser) {
    if (editing) {
      return (
        <div className="msg-in flex justify-end gap-3">
          <div className="flex max-w-[85%] flex-col items-end gap-1.5">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim() && onEditUser) {
                    onEditUser(message.id, draft.trim());
                    setEditing(false);
                  }
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(message.content);
                }
              }}
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              className="scrollbar-hud w-full rounded-lg rounded-tr-sm border border-cyan-400/50 bg-[#0a1626] px-4 py-2.5 text-sm leading-relaxed text-cyan-50 outline-none focus:border-cyan-300/70"
              aria-label="Edit message"
            />
            <div className="flex items-center gap-1.5">
              <span className="mr-1 font-mono text-[9px] tracking-widest text-zinc-600">
                ENTER TO RESEND · ESC TO CANCEL
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                aria-label="Cancel edit"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (draft.trim() && onEditUser) {
                    onEditUser(message.id, draft.trim());
                    setEditing(false);
                  }
                }}
                disabled={!draft.trim()}
                className="flex h-7 items-center gap-1.5 rounded-md border border-cyan-400/50 bg-cyan-500/15 px-2.5 font-mono text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
                aria-label="Save and resend"
              >
                <CornerDownLeft className="h-3 w-3" /> Resend
              </button>
            </div>
          </div>
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-[#081120]">
            <User className="h-4 w-4 text-cyan-300/80" />
          </div>
        </div>
      );
    }

    return (
      <div className="msg-in group flex justify-end gap-3">
        <div className="flex max-w-[85%] flex-col items-end">
          {message.images && message.images.length > 0 && (
            <div
              className={cn(
                "mb-1.5 grid gap-1.5",
                message.images.length === 1 ? "grid-cols-1" : "grid-cols-2"
              )}
            >
              {message.images.map((src, i) => (
                <a
                  key={`${src}-${i}`}
                  href={src}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block overflow-hidden rounded-lg border border-cyan-500/25 bg-[#081120] transition-colors hover:border-cyan-400/50"
                  aria-label={`Attached image ${i + 1} — open full size`}
                >
                  
                  <img
                    src={src}
                    alt={`Image attached by user ${i + 1}`}
                    loading="lazy"
                    className={cn(
                      "object-cover",
                      message.images && message.images.length === 1
                        ? "max-h-64 max-w-full"
                        : "h-32 w-32"
                    )}
                  />
                </a>
              ))}
            </div>
          )}
          {message.documents && message.documents.length > 0 && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-2">
              {message.documents.map((doc) => (
                <a
                  key={doc.id}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex max-w-[220px] items-center gap-2 rounded-lg border border-cyan-500/25 bg-[#081120] px-3 py-2 transition-colors hover:border-cyan-400/50"
                  aria-label={`Attached ${doc.label} file ${doc.name} — open`}
                >
                  {doc.kind === "audio" ? (
                    <Music className="h-4 w-4 shrink-0 text-cyan-400/80" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-cyan-400/80" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-zinc-200">{doc.name}</span>
                    <span className="block font-mono text-[9px] uppercase tracking-widest text-cyan-400/70">
                      {doc.label}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="rounded-lg rounded-tr-sm border border-cyan-500/25 bg-cyan-500/10 px-4 py-2.5">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-cyan-50">
              {message.content}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <span className="mr-1 font-mono text-[9px] text-zinc-600">
              {timeLabel(message.createdAt)}
            </span>
            <button
              type="button"
              onClick={copy}
              className="rounded p-1 text-zinc-500 hover:text-cyan-300"
              aria-label="Copy message"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              className="rounded p-1 text-zinc-500 hover:text-cyan-300 disabled:opacity-30"
              aria-label="Edit and resend"
              title="Edit & resend"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-[#081120]">
          <User className="h-4 w-4 text-cyan-300/80" aria-label="You" />
        </div>
      </div>
    );
  }

  // ── Assistant message ───────────────────────────────────────────────────
  return (
    <div className="msg-in group flex gap-3">
      <div className="mt-0.5 h-8 w-8 shrink-0">
        <ArcReactor size={32} active={!message.streaming} intensity={message.streaming ? 0.9 : 0.55} />
      </div>
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-400/80">
            J.A.R.V.I.S.
          </span>
          {message.engine && (
            <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">
              {message.engine === "groq" ? "groq" : "core"}
            </span>
          )}
          <span className="font-mono text-[9px] text-zinc-700">
            {timeLabel(message.createdAt)}
          </span>
        </div>

        {message.tools.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {message.tools.map((tool) => (
              <ToolCardView key={tool.id} card={tool} />
            ))}
          </div>
        )}

        {(message.content || message.streaming) && (
          <div className="mt-2 rounded-lg rounded-tl-sm border border-zinc-800 bg-[#0a1424]/60 px-4 py-3">
            {message.content ? (
              <MarkdownBody content={message.content} />
            ) : (
              <span className="inline-block h-4 w-2 animate-pulse bg-cyan-400/80" />
            )}
            {message.streaming && message.content && (
              <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-cyan-400/80" />
            )}
          </div>
        )}

        {message.error && (
          <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {message.error}
          </div>
        )}

        <div
          className={cn(
            "mt-1 flex items-center gap-0.5 transition-opacity",
            !message.streaming && message.content
              ? "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
              : "hidden"
          )}
        >
          <button
            type="button"
            onClick={copy}
            className="rounded p-1 text-zinc-500 hover:text-cyan-300"
            aria-label="Copy message"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
          {onRegenerate && !message.streaming && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRegenerate(message.id)}
              className="rounded p-1 text-zinc-500 hover:text-cyan-300 disabled:opacity-30"
              aria-label="Regenerate response"
              title="Regenerate from here"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          {copied && (
            <span className="ml-1 font-mono text-[9px] text-zinc-600">copied</span>
          )}
        </div>
      </div>
    </div>
  );
});
