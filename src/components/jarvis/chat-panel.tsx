"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChatSSEEvent } from "@/lib/types";
import { api, streamChat, type StoredSessionMessage } from "@/lib/client/api";
import { useJarvisStore } from "@/lib/client/store";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { MessageItem } from "@/components/jarvis/message-item";
import { ApprovalCard } from "@/components/jarvis/approval-card";
import { Waveform } from "@/components/jarvis/visuals/waveform";
import { ArcReactor } from "@/components/jarvis/visuals/arc-reactor";
import {
  Cpu,
  Globe,
  FolderOpen,
  Zap,
  TerminalSquare,
  Mic,
  MicOff,
  Send,
  Square,
  Volume2,
  VolumeX,
  Image as ImageIcon,
  Plus,
  X,
  FileText,
  Music,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ATTACH_ACCEPT } from "@/lib/attachment-specs";

const SUGGESTIONS = [
  {
    icon: ImageIcon,
    label: "Generate an image",
    text: "Generate an image: a futuristic arc reactor core glowing cyan on a dark HUD background, highly detailed.",
  },
  {
    icon: Cpu,
    label: "Full system diagnostic",
    text: "Run a full system diagnostic and report CPU, memory, disk and uptime.",
  },
  {
    icon: FolderOpen,
    label: "Scan my files",
    text: "Explore my project directory and summarize what this codebase is.",
  },
  {
    icon: Globe,
    label: "Search the web",
    text: "Search the web for today's most important AI news and summarize it.",
  },
  {
    icon: FileText,
    label: "Read my documents",
    text: "I will attach a PDF or document with the + button — then summarize it and pull out every key number.",
  },
  {
    icon: TerminalSquare,
    label: "Terminal demo",
    text: "Show off your terminal access: check the OS version, who I am, and what processes are running.",
  },
  {
    icon: Zap,
    label: "Write + run code",
    text: "Write a fun Python script in the project's download folder and run it for me.",
  },
];

/** Per-kind attachment caps (server enforces the same limits). */
const MAX_IMAGES = 4;
const MAX_DOCS = 4;
const MAX_AUDIO = 2;
/** Max size for a document/audio upload (server enforces the same limit). */
const MAX_FILE_MB = 20;

const DOC_EXTENSIONS = new Set([
  "pdf", "docx", "pptx", "xlsx", "ods", "odt", "rtf", "epub", "csv", "tsv",
  "txt", "md", "json", "xml", "yml", "yaml", "html", "htm", "log", "ini",
  "toml", "env", "sql", "sh", "js", "jsx", "ts", "tsx", "py", "java", "c",
  "h", "cpp", "cs", "go", "rs", "rb", "php", "css",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "flac", "ogg", "oga", "aac", "webm", "opus",
]);

interface Attachment {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
  kind: "image" | "document" | "audio";
  ext: string;
}

/** Classify a picked file by browser mime and/or its extension. */
function classifyFile(file: File): "image" | "document" | "audio" | null {
  if (file.type.startsWith("image/")) return "image";
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (file.type.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (DOC_EXTENSIONS.has(ext)) return "document";
  if (file.type === "text/plain" || file.type === "application/octet-stream") {
    return DOC_EXTENSIONS.has(ext) ? "document" : null;
  }
  return null;
}

/** Human label for an extension. */
function extLabel(ext: string): string {
  return ext.toUpperCase();
}

/** Read any non-image file → attachment (no processing, size capped). */
async function fileToDocumentAttachment(file: File): Promise<Attachment | null> {
  const kind = classifyFile(file);
  if (!kind || kind === "image") return null;
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    toast.error(`${file.name || "File"} is too large (max ${MAX_FILE_MB} MB)`);
    return null;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
  if (!dataUrl.startsWith("data:")) return null;
  return {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "file",
    dataUrl,
    size: file.size,
    kind,
    ext: (file.name.split(".").pop() ?? "").toLowerCase(),
  };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Read an image file → attachment with a client-side downscale pass.
 * Large photos are resized to ≤1568px JPEG (plenty for vision analysis)
 * so uploads stay fast even on slow connections. Small files and GIFs
 * are passed through untouched.
 */
async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) {
    toast.error(`${file.name || "File"} is not an image`);
    return null;
  }
  if (file.size > 15 * 1024 * 1024) {
    toast.error(`${file.name || "Image"} is too large (max 15 MB)`);
    return null;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const base: Attachment = {
    id,
    name: file.name || "image",
    dataUrl,
    size: file.size,
    kind: "image",
    ext: (file.name.split(".").pop() ?? "png").toLowerCase(),
  };
  if (file.type === "image/gif" || file.size < 400 * 1024) return base;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = dataUrl;
    });
    const maxDim = 1568;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return base;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", 0.85);
    if (out && out.length < dataUrl.length) {
      return { ...base, dataUrl: out, size: Math.round(out.length * 0.75) };
    }
    return base;
  } catch {
    return base;
  }
}

export function ChatPanel() {
  const messages = useJarvisStore((s) => s.messages);
  const streaming = useJarvisStore((s) => s.streaming);
  const statusLabel = useJarvisStore((s) => s.statusLabel);
  const approvals = useJarvisStore((s) => s.approvals);
  const settings = useJarvisStore((s) => s.settings);
  const activeSessionId = useJarvisStore((s) => s.activeSessionId);
  const engineInfo = useJarvisStore((s) => s.engineInfo);
  const setVoiceState = useJarvisStore((s) => s.setVoiceState);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const assistantIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const store = useJarvisStore; // stable store object for actions

  const tts = useSpeechSynthesis({
    enabled: !!settings?.speakResponses,
    voiceURI: settings?.voiceUri,
    rate: settings?.voiceRate ?? 1,
    pitch: settings?.voicePitch ?? 1,
  });

  const addFiles = useCallback(async (files: File[]) => {
    const usable = files
      .map((f) => ({ f, kind: classifyFile(f) }))
      .filter((x): x is { f: File; kind: "image" | "document" | "audio" } => !!x.kind);
    if (usable.length === 0) {
      if (files.length)
        toast.error("Unsupported file type — images, documents and audio only");
      return;
    }
    for (const { f, kind } of usable) {
      try {
        const count = (k: "image" | "document" | "audio") =>
          attachments.filter((a) => a.kind === k).length;
        if (kind === "image" && count("image") >= MAX_IMAGES) {
          toast.error(`Max ${MAX_IMAGES} images per message`);
          continue;
        }
        if (kind === "document" && count("document") >= MAX_DOCS) {
          toast.error(`Max ${MAX_DOCS} documents per message`);
          continue;
        }
        if (kind === "audio" && count("audio") >= MAX_AUDIO) {
          toast.error(`Max ${MAX_AUDIO} audio files per message`);
          continue;
        }
        const att =
          kind === "image" ? await fileToAttachment(f) : await fileToDocumentAttachment(f);
        if (att) setAttachments((prev) => [...prev, att]);
      } catch {
        toast.error(`Could not read ${f.name || "file"}`);
      }
    }
  }, [attachments]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const send = useCallback(
    async (text: string, images?: string[]) => {
      const trimmed = text.trim();
      const s = store.getState();
      const imageList =
        images ??
        (attachments.some((a) => a.kind === "image")
          ? attachments.filter((a) => a.kind === "image").map((a) => a.dataUrl)
          : undefined);
      const documentList = attachments.some((a) => a.kind !== "image")
        ? attachments
            .filter((a) => a.kind !== "image")
            .map((a) => ({ name: a.name, dataUri: a.dataUrl }))
        : undefined;
      if ((!trimmed && !imageList?.length && !documentList?.length) || s.streaming)
        return;

      const finalText =
        trimmed ||
        (documentList?.length
          ? "Please analyze the attached file(s)."
          : "Please analyze the attached image(s).");
      const userId = `u_${Date.now()}`;
      const assistantId = `a_${Date.now()}`;
      assistantIdRef.current = assistantId;
      s.appendMessage({
        id: userId,
        role: "user",
        content: finalText,
        tools: [],
        ...(imageList?.length ? { images: imageList } : {}),
        ...(documentList?.length
          ? {
              documents: attachments
                .filter(
                  (a): a is Attachment & { kind: "document" | "audio" } =>
                    a.kind === "document" || a.kind === "audio"
                )
                .map((a) => ({
                  id: a.id,
                  name: a.name,
                  kind: a.kind,
                  ext: a.ext,
                  label: extLabel(a.ext),
                  url: "",
                })),
            }
          : {}),
        createdAt: Date.now(),
      });
      s.appendMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        tools: [],
        streaming: true,
        createdAt: Date.now(),
      });
      s.setStreaming(true);
      s.setStatusLabel(
        imageList?.length
          ? "Analyzing image"
          : documentList?.length
            ? "Reading files"
            : "Connecting"
      );
      s.pushActivity({
        kind: "info",
        text: "Request sent",
        detail: finalText.slice(0, 100),
      });
      tts.cancel();
      if (!images) setAttachments([]);

      const controller = new AbortController();
      abortRef.current = controller;

      // Recovery bookkeeping — real ids the server assigns during this turn.
      let activeSid = s.activeSessionId;
      let realUserDbId: string | null = null;
      const sendStartedAt = Date.now();

      const handleEvent = (ev: ChatSSEEvent) => {
        const st = store.getState();
        const currentAssistantId = assistantIdRef.current;
        switch (ev.type) {
          case "session":
            activeSid = ev.sessionId;
            st.setActiveSessionId(ev.sessionId);
            break;
          case "user_message":
            // Real DB id for the just-sent user message (enables edit/regenerate + recovery)
            realUserDbId = ev.id;
            st.patchMessage(userId, {
              id: ev.id,
              ...(ev.images?.length ? { images: ev.images } : {}),
              ...(ev.documents?.length ? { documents: ev.documents } : {}),
            });
            break;
          case "engine":
            st.setEngineInfo(ev);
            if (ev.note) st.pushActivity({ kind: "info", text: "Core", detail: ev.note });
            if (currentAssistantId) {
              st.patchMessage(currentAssistantId, { engine: ev.engine });
            }
            break;
          case "status":
            st.setStatusLabel(ev.label);
            break;
          case "delta":
            if (currentAssistantId) {
              st.appendDelta(currentAssistantId, ev.text);
              tts.feed(ev.text);
            }
            break;
          case "tool":
            if (currentAssistantId) {
              st.upsertToolCard(currentAssistantId, {
                id: ev.id,
                name: ev.name,
                args: ev.args,
                state: ev.state,
                result: ev.result,
                ms: ev.ms,
              });
            }
            st.pushActivity({
              kind: "tool",
              text: ev.name.replace(/_/g, " "),
              detail:
                String(ev.args.command ?? ev.args.path ?? ev.args.query ?? ev.args.url ?? "").slice(0, 120),
              state: ev.state,
            });
            break;
          case "approval":
            st.setApproval({
              approvalId: ev.approvalId,
              toolId: ev.toolId,
              command: ev.command,
              reason: ev.reason,
              expiresAt: Date.now() + ev.expiresIn * 1000,
            });
            st.pushActivity({
              kind: "approval",
              text: "Approval requested",
              detail: ev.command.slice(0, 120),
            });
            break;
          case "error":
            if (currentAssistantId) {
              st.patchMessage(currentAssistantId, { error: ev.message });
            }
            st.pushActivity({ kind: "error", text: ev.message });
            toast.error(ev.message);
            break;
          case "done":
            if (currentAssistantId) {
              st.patchMessage(currentAssistantId, {
                id: ev.messageId,
                streaming: false,
                ...(ev.content ? { content: ev.content } : {}),
              });
            }
            st.setLastLatencyMs(ev.ms);
            st.setStatusLabel("");
            st.loadSessions();
            tts.flush();
            break;
        }
      };

      /**
       * AUTO-RECOVERY — if the SSE link dies mid-turn (proxy idle-kill,
       * network blip), the server still finishes the work and persists the
       * full reply to the session DB (that's why images kept landing in
       * Files even though the chat showed an error). Poll the session and
       * graft the finished reply into the chat instead of erroring out.
       * Returns true when the reply was recovered.
       */
      const recoverReply = async (): Promise<boolean> => {
        const sid = activeSid ?? store.getState().activeSessionId;
        if (!sid || controller.signal.aborted) return false;
        const bubbleId = assistantId;
        const recoverStart = Date.now();
        const deadline = recoverStart + 240_000; // long enough for image synthesis + retries
        store
          .getState()
          .pushActivity({ kind: "info", text: "Link lost — recovering response…" });

        while (Date.now() < deadline && !controller.signal.aborted) {
          try {
            const detail = await api.getSession(sid);
            let reply: StoredSessionMessage | null = null;
            if (realUserDbId) {
              const idx = detail.messages.findIndex((m) => m.id === realUserDbId);
              const nxt = idx >= 0 ? detail.messages[idx + 1] : undefined;
              if (nxt && nxt.role === "assistant") reply = nxt;
            } else {
              // Turn died before the server echoed the user id — fall back to
              // the first assistant message created since send started.
              reply =
                detail.messages.find(
                  (m) =>
                    m.role === "assistant" &&
                    new Date(m.createdAt).getTime() >= sendStartedAt - 5_000
                ) ?? null;
            }
            // The server persists the assistant message exactly once, at the
            // end of the turn — a non-local id means the reply is COMPLETE.
            if (reply && reply.id && !reply.id.startsWith("local_")) {
              const st = store.getState();
              st.patchMessage(bubbleId, {
                id: reply.id,
                streaming: false,
                content: reply.content,
                tools: reply.meta?.tools ?? [],
                ...(reply.meta?.engine ? { engine: reply.meta.engine } : {}),
                ...(reply.meta?.error ? { error: reply.meta.error } : {}),
              });
              st.setLastLatencyMs(Date.now() - sendStartedAt);
              st.setStatusLabel("");
              st.pushActivity({ kind: "info", text: "Response recovered from core" });
              st.loadSessions();
              toast.success("Link hiccupped mid-reply — recovered the finished response.");
              return true;
            }
          } catch {
            // transient poll failure — keep waiting
          }
          store
            .getState()
            .setStatusLabel(
              `Recovering response — ${Math.round((Date.now() - recoverStart) / 1000)}s`
            );
          await new Promise((r) => setTimeout(r, 4_000));
        }
        return false;
      };

      let recovered = false;
      try {
        const result = await streamChat(
          {
            sessionId: s.activeSessionId,
            message: finalText,
            ...(imageList?.length ? { images: imageList } : {}),
            ...(documentList?.length ? { documents: documentList } : {}),
          },
          { onEvent: handleEvent, signal: controller.signal }
        );
        // Stream ended without the server's done event and the user did not
        // press stop → the link died. Recover the persisted reply instead of
        // showing a scary error (the core kept working — see Files).
        if (!result.gotDone && !controller.signal.aborted) {
          recovered = await recoverReply();
          if (!recovered && !controller.signal.aborted) {
            const msg =
              "Connection lost before the core finished. If this turn was generating an image, it may still appear in Files — or reopen this session later.";
            const st = store.getState();
            if (assistantIdRef.current) st.patchMessage(assistantIdRef.current, { error: msg });
            st.pushActivity({ kind: "error", text: msg });
            toast.error(msg);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast.error(`Connection fault: ${(e as Error).message}`);
          store
            .getState()
            .pushActivity({ kind: "error", text: `Connection fault: ${(e as Error).message}` });
        }
      } finally {
        const st = store.getState();
        if (assistantIdRef.current) {
          st.patchMessage(assistantIdRef.current, { streaming: false });
        }
        st.setStreaming(false);
        st.setStatusLabel("");
        tts.flush();
        abortRef.current = null;
      }
    },
    [attachments, tts, store]
  );

  const stopStreaming = () => {
    abortRef.current?.abort();
    tts.cancel();
    store.getState().setStreaming(false);
    store.getState().setStatusLabel("");
  };

  // ── Edit & regenerate (ChatGPT-style) ────────────────────────────────────
  const editUserMessage = async (messageId: string, newText: string) => {
    const s = store.getState();
    if (s.streaming || !newText.trim()) return;
    const sessionId = s.activeSessionId;
    try {
      if (sessionId) await api.truncateSession(sessionId, messageId, "from");
      store.getState().truncateMessages(messageId);
      await send(newText);
    } catch (e) {
      toast.error(`Could not edit: ${(e as Error).message}`);
    }
  };

  const regenerate = async (assistantMsgId: string) => {
    const s = store.getState();
    if (s.streaming) return;
    const sessionId = s.activeSessionId;
    const msgs = s.messages;
    const idx = msgs.findIndex((m) => m.id === assistantMsgId);
    if (idx < 0) return;
    // find the user message this response answered
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;
    const text = msgs[userIdx].content;
    const userMsgId = msgs[userIdx].id;
    try {
      if (sessionId) await api.truncateSession(sessionId, userMsgId, "from");
      store.getState().truncateMessages(userMsgId);
      await send(text);
    } catch (e) {
      toast.error(`Could not regenerate: ${(e as Error).message}`);
    }
  };

  // ── Speech recognition ───────────────────────────────────────────────────
  const recognition = useSpeechRecognition({
    onFinal: (text) => {
      const s = store.getState();
      if (s.settings?.autoSendVoice !== false) {
        send(text);
      } else {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
      }
    },
    wakeWord: !!settings?.wakeWord,
    onWake: () => {
      tts.speakNow("Yes, sir?");
      toast("JARVIS is listening…");
    },
    lang: settings?.sttLang || "en-US",
    micDeviceId: settings?.micDeviceId || "",
  });

  const micSupported = recognition.supported;

  // Surface mic device issues once
  const micErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (recognition.micError && micErrorRef.current !== recognition.micError) {
      micErrorRef.current = recognition.micError;
      toast.warning(recognition.micError, {
        description: "Pick another microphone in Settings → Voice Input.",
      });
    }
    if (!recognition.micError) micErrorRef.current = null;
  }, [recognition.micError]);

  const toggleMic = () => {
    if (!micSupported) {
      toast.error("Speech recognition is not supported in this browser — try Chrome or Edge.");
      return;
    }
    if (recognition.listening) {
      recognition.stop();
    } else {
      recognition.startOnce();
      toast("Listening…");
    }
  };

  // ── Auto scroll + voice state sync ───────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, statusLabel, attachments]);

  // Register sender for cross-component use (file tree "ask JARVIS", etc.)
  const registerSender = useJarvisStore((s) => s.registerSender);
  useEffect(() => {
    registerSender((text) => void send(text));
    return () => registerSender(null);
  }, [send, registerSender]);

  useEffect(() => {
    if (streaming) setVoiceState("thinking");
    else if (tts.speaking) setVoiceState("speaking");
    else if (recognition.listening) setVoiceState("listening");
    else setVoiceState("idle");
  }, [streaming, tts.speaking, recognition.listening, setVoiceState]);

  const toggleVoiceOutput = async () => {
    if (!settings) return;
    try {
      await api.saveSettings({ speakResponses: !settings.speakResponses });
      await store.getState().loadSettings();
      if (!settings.speakResponses) tts.speakNow("Voice output online.");
    } catch {
      toast.error("Could not save setting");
    }
  };

  const hasMessages = messages.length > 0;
  const activeApprovalList = Object.values(approvals);
  const canSend = !!input.trim() || attachments.length > 0;

  const waveformState: "idle" | "listening" | "speaking" | "thinking" = streaming
    ? "thinking"
    : tts.speaking
      ? "speaking"
      : recognition.listening
        ? "listening"
        : "idle";

  const readyLabel = engineInfo?.model
    ? `Ready — ${engineInfo.model}`
    : "Standing by";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div className="scrollbar-hud min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {!hasMessages && (
            <EmptyState onPick={(t) => send(t)} userName={settings?.userName ?? "sir"} />
          )}

          <div className="space-y-6">
            {messages.map((m) => (
              <div key={m.id}>
                <MessageItem
                  message={m}
                  busy={streaming}
                  onEditUser={(msgId, newText) => void editUserMessage(msgId, newText)}
                  onRegenerate={(msgId) => void regenerate(msgId)}
                />
                {m.role === "assistant" && m.streaming && activeApprovalList.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {activeApprovalList.map((a) => (
                      <ApprovalCard
                        key={a.approvalId}
                        approval={a}
                        onResolved={() => {
                          /* stream continues server-side */
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div ref={bottomRef} className="h-2" />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-cyan-500/10 bg-[#050b16]/90 backdrop-blur-md">
        <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
          <div className="mb-2 flex h-6 items-center gap-3 overflow-hidden">
            <Waveform state={waveformState} bars={36} height={22} className="h-[22px] w-32 shrink-0" />
            <p
              className={cn(
                "min-w-0 shrink-0 truncate font-mono text-[10px] uppercase tracking-[0.2em]",
                streaming || tts.speaking || recognition.listening
                  ? "text-cyan-300/90"
                  : "text-zinc-600"
              )}
            >
              {recognition.listening
                ? "Listening"
                : streaming
                  ? statusLabel || "Processing"
                  : tts.speaking
                    ? "Speaking"
                    : readyLabel}
            </p>
            {recognition.interim && (
              <p className="min-w-0 flex-1 truncate text-xs italic text-cyan-300/60">
                “{recognition.interim}”
              </p>
            )}
          </div>

          {/* Attachments preview strip (images + documents + audio) */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((att) =>
                att.kind === "image" ? (
                  <div
                    key={att.id}
                    className="group relative h-20 w-20 overflow-hidden rounded-lg border border-cyan-500/30 bg-[#081120]"
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={`Remove ${att.name}`}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-red-400/60 bg-black/70 text-red-300 transition-colors hover:bg-red-500/40"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 font-mono text-[8px] text-zinc-300">
                      {att.name}
                    </span>
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="group relative flex h-20 max-w-[180px] items-center gap-2 overflow-hidden rounded-lg border border-cyan-500/30 bg-[#081120] px-3"
                  >
                    {att.kind === "audio" ? (
                      <Music className="h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
                    ) : (
                      <FileText className="h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs text-zinc-200">{att.name}</p>
                      <p className="font-mono text-[9px] uppercase tracking-widest text-cyan-400/70">
                        {extLabel(att.ext)} ·{" "}
                        {att.size > 1024 * 1024
                          ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
                          : `${Math.max(1, Math.round(att.size / 1024))} KB`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={`Remove ${att.name}`}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-red-400/60 bg-black/70 text-red-300 transition-colors hover:bg-red-500/40"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Add another file"
                className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-cyan-500/30 text-cyan-400/60 transition-colors hover:border-cyan-400/60 hover:text-cyan-300"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          )}

          <div
            className={cn(
              "flex items-end gap-2 rounded-xl transition-shadow",
              dragOver &&
                "ring-2 ring-cyan-400/60 ring-offset-0"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files ?? []);
              if (files.length) void addFiles(files);
            }}
          >
            {/* + attach files button (images / documents / audio) */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || attachments.length >= MAX_IMAGES + MAX_DOCS + MAX_AUDIO}
              aria-label="Attach files"
              title="Attach images, documents or audio (or paste / drag them in)"
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all",
                attachments.length >= MAX_IMAGES + MAX_DOCS + MAX_AUDIO
                  ? "border-zinc-800 bg-[#081120] text-zinc-600"
                  : "border-cyan-500/30 bg-[#081120] text-cyan-400/80 hover:border-cyan-400/60 hover:text-cyan-300",
                streaming && "opacity-40"
              )}
            >
              <Plus className="h-5 w-5" />
              {attachments.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-cyan-300/60 bg-cyan-500/80 font-mono text-[9px] font-bold text-black">
                  {attachments.length}
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACH_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = ""; // allow re-selecting the same file
                if (files.length) void addFiles(files);
              }}
            />

            <button
              type="button"
              onClick={toggleMic}
              disabled={streaming}
              aria-label={recognition.listening ? "Stop listening" : "Start voice input"}
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all",
                recognition.listening
                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.4)]"
                  : "border-cyan-500/30 bg-[#081120] text-cyan-400/80 hover:border-cyan-400/60 hover:text-cyan-300",
                streaming && "opacity-40"
              )}
            >
              {micSupported ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              {recognition.listening && (
                <span className="absolute inset-0 animate-ping rounded-full border border-cyan-400/40" />
              )}
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData?.files ?? []);
                const usable = items.filter((f) => classifyFile(f));
                if (usable.length) {
                  e.preventDefault();
                  void addFiles(usable);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const t = input;
                  setInput("");
                  send(t);
                }
              }}
              rows={1}
              placeholder={
                recognition.listening
                  ? "Listening…"
                  : attachments.length
                    ? "Ask anything about the attached files…"
                    : "Speak or type a command, sir…"
              }
              aria-label="Message input"
              className="scrollbar-hud max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-cyan-500/20 bg-[#081120]/80 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
            />

            {streaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                aria-label="Stop response"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const t = input;
                  setInput("");
                  send(t);
                }}
                disabled={!canSend}
                aria-label="Send message"
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all",
                  canSend
                    ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.25)] hover:bg-cyan-500/30"
                    : "border-zinc-800 bg-[#081120] text-zinc-600"
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between">
            <p className="hidden font-mono text-[9px] tracking-widest text-zinc-700 sm:block">
              ENTER TO SEND · SHIFT+ENTER NEW LINE · + FOR IMAGES, DOCS & AUDIO
            </p>
            <button
              type="button"
              onClick={toggleVoiceOutput}
              className="flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-cyan-300"
              aria-label="Toggle voice output"
            >
              {settings?.speakResponses ? (
                <>
                  <Volume2 className="h-3.5 w-3.5 text-cyan-400" /> Voice on
                </>
              ) : (
                <>
                  <VolumeX className="h-3.5 w-3.5" /> Voice off
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
  userName,
}: {
  onPick: (text: string) => void;
  userName: string;
}) {
  return (
    <div className="flex flex-col items-center pt-6 pb-2 text-center sm:pt-12">
      <ArcReactor size={150} active intensity={0.9} />
      <h1 className="text-glow mt-6 text-2xl font-light tracking-[0.3em] text-cyan-100 sm:text-3xl">
        {greeting()}, {userName}.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
        All systems are online. I have terminal access to this machine, full filesystem
        control, live internet, image generation — and I am fully multimodal: attach
        images, documents (PDF, Word, Excel, slides, code, data) or audio with the{" "}
        <span className="font-mono text-cyan-300">+</span> button. Speak or type a command.
      </p>
      <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.text)}
            className="group flex items-center gap-3 rounded-lg border border-cyan-500/15 bg-[#081120]/60 px-4 py-3 text-left transition-all hover:border-cyan-400/40 hover:bg-cyan-500/5 hover:shadow-[0_0_18px_rgba(34,211,238,0.12)]"
          >
            <s.icon className="h-4 w-4 shrink-0 text-cyan-400/70 transition-colors group-hover:text-cyan-300" />
            <span className="text-sm text-zinc-300 group-hover:text-cyan-100">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
