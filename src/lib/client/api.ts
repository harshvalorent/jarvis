"use client";

import type {
  AssistantMeta,
  ChatSSEEvent,
  FileEntry,
  SessionSummary,
  ReasoningMode,
  SafetyLevel,
  ToolPermissions,
  UserMeta,
  WebAccessMode,
} from "@/lib/types";

// ─── SSE streaming chat client ───────────────────────────────────────────────

export interface StreamChatResult {
  /**
   * true  — the server sent its `done` event; the turn is fully complete.
   * false — the stream ended without `done` (idle-kill by a proxy, network
   *         drop, or a genuine user abort). Callers can auto-recover by
   *         re-reading the persisted session instead of showing an error,
   *         because the server finishes + persists the reply regardless.
   */
  gotDone: boolean;
  /** Set when the stream died abnormally (network fault, not a user abort). */
  error?: Error;
}

export async function streamChat(
  body: {
    sessionId: string | null;
    message: string;
    images?: string[];
    documents?: { name?: string; dataUri?: string }[];
  },
  handlers: {
    onEvent: (ev: ChatSSEEvent) => void;
    signal?: AbortSignal;
  }
): Promise<StreamChatResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (e) {
    const err = e as Error;
    // User abort is a normal end (stop button) — not a fault.
    if (err.name === "AbortError") return { gotDone: false };
    return { gotDone: false, error: err };
  }

  if (!res.ok || !res.body) {
    let message = `Chat request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // ignore
    }
    handlers.onEvent({ type: "error", message });
    return { gotDone: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let gotDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        let eventType = "";
        let data = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const ev = JSON.parse(data) as ChatSSEEvent;
          if (eventType === "ping" || ev.type === "ping") continue;
          if (ev.type === "done") gotDone = true;
          handlers.onEvent(ev);
        } catch {
          // ignore malformed event
        }
      }
    }
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return { gotDone: false };
    // Network-level drop mid-stream (idle proxy kill etc.) — the server keeps
    // working and persists the reply; let the caller run recovery.
    return { gotDone: false, error: err };
  }

  // Clean EOF but no `done` event → an intermediary closed the stream early.
  return { gotDone };
}

// ─── Simple JSON helpers ─────────────────────────────────────────────────────

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

export interface SettingsResponse {
  speakResponses: boolean;
  autoSendVoice: boolean;
  wakeWord: boolean;
  voiceRate: number;
  voicePitch: number;
  voiceUri: string;
  userName: string;
  customInstructions: string;
  responseStyle: "concise" | "balanced" | "detailed";
  micDeviceId: string;
  sttLang: string;
  coreSystemPrompt: string;
  reasoningMode: ReasoningMode;
  safetyLevel: SafetyLevel;
  webAccessMode: WebAccessMode;
  toolPermissions: ToolPermissions;
}

export interface DiagnosticResult {
  ok: boolean;
  ms?: number;
  detail?: string;
  error?: string;
}

export interface DiagnosticsResponse {
  core: { ok: boolean; ms?: number; detail?: string; error?: string };
  vision: { ok: boolean; ms?: number; detail?: string; error?: string };
  documents?: { ok: boolean; ms?: number; detail?: string; error?: string };
  tools?: Record<string, DiagnosticResult>;
  mode?: ReasoningMode;
}

// ─── AI provider configuration ───────────────────────────────────────────────

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  hasModelList: boolean;
  note: string;
}

export interface CustomProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
}

export interface AiConfigResponse {
  provider: string;
  baseUrl: string;
  apiKeySet: boolean;
  model: string;
  visionModel: string;
  asrModel: string;
  customProviders: CustomProviderInfo[];
  presets: ProviderPreset[];
  fileConfig: { exists: boolean; baseUrl?: string; model?: string };
}

export interface AiModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  free?: boolean;
}

export interface AiModelsResponse {
  provider: string;
  baseUrl: string;
  count: number;
  models: AiModelInfo[];
}

export interface CapabilityReport {
  model: string;
  provider: string;
  text: { ok: boolean; ms: number; error?: string };
  tools: { ok: boolean };
  image: { ok: boolean; error?: string };
  pcControl: { level: "full" | "web-only" | "chat-only"; detail: string };
  /** Modalities claimed by the provider's model catalog (video/audio are metadata-only). */
  reportedModalities?: string[];
  probedAt: string;
}

export interface CachedCapabilityResponse extends Partial<CapabilityReport> {
  cached: boolean;
}

export interface StoredSessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta: (AssistantMeta & UserMeta) | null;
  createdAt: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  messageCount: number;
  messages: StoredSessionMessage[];
}

export const api = {
  getSettings: () => fetchJson<SettingsResponse>("/api/settings"),
  saveSettings: (patch: Partial<SettingsResponse>) =>
    fetchJson<SettingsResponse>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  testEngines: (full = false) =>
    fetchJson<DiagnosticsResponse>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: full ? "diagnostics" : "test" }),
    }),
  getSessions: () => fetchJson<SessionSummary[]>("/api/sessions"),
  getSession: (id: string) => fetchJson<SessionDetail>(`/api/sessions/${id}`),
  deleteSession: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
  renameSession: (id: string, title: string) =>
    fetchJson<{ ok: boolean }>(`/api/sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  clearAllSessions: () =>
    fetchJson<{ ok: boolean }>("/api/sessions", { method: "DELETE" }),
  truncateSession: (id: string, messageId: string, mode: "from" | "after") =>
    fetchJson<{ ok: boolean; remaining: number }>(`/api/sessions/${id}/truncate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, mode }),
    }),
  getSystemStats: () => fetchJson<import("@/lib/types").SystemStats>("/api/system"),
  listFiles: (path: string) =>
    fetchJson<{ path: string; parent: string; entries: FileEntry[]; count: number }>(
      `/api/files?path=${encodeURIComponent(path)}`
    ),
  readFile: (path: string) =>
    fetchJson<{
      path: string;
      content: string | null;
      truncated?: boolean;
      binary?: boolean;
      size?: number;
      sizeLabel?: string;
    }>(`/api/files?path=${encodeURIComponent(path)}&read=1`),
  writeFile: (path: string, content: string) =>
    fetchJson<{ ok: boolean }>("/api/files", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
  fileAction: (action: "mkdir" | "delete" | "rename", path: string, to?: string) =>
    fetchJson<{ ok: boolean }>("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, path, to }),
    }),
  approve: (id: string, approved: boolean) =>
    fetchJson<{ ok: boolean }>("/api/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approved }),
    }),
  getAiConfig: () => fetchJson<AiConfigResponse>("/api/ai/config"),
  saveAiConfig: (
    patch: {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      visionModel?: string;
      asrModel?: string;
      customProviders?: CustomProviderInfo[];
    }
  ) =>
    fetchJson<AiConfigResponse>("/api/ai/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  listModels: (params: { provider?: string; baseUrl?: string; key?: string }) => {
    const q = new URLSearchParams();
    if (params.provider) q.set("provider", params.provider);
    if (params.baseUrl) q.set("baseUrl", params.baseUrl);
    if (params.key) q.set("key", params.key);
    return fetchJson<AiModelsResponse>(`/api/ai/models?${q.toString()}`);
  },
  probeCapabilities: (body: { model: string; provider?: string }) =>
    fetchJson<CapabilityReport>("/api/ai/capabilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  getCachedCapabilities: (model: string, provider = "saved") =>
    fetchJson<CachedCapabilityResponse>(
      `/api/ai/capabilities?model=${encodeURIComponent(model)}&provider=${encodeURIComponent(provider)}`
    ),
};
