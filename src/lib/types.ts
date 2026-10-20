// ─── Shared types used by both server and client ───────────────────────────

/** Kept for message-meta compatibility — the core is now always "zai" (built-in). */
export type EngineKind = "groq" | "zai";

/** A document/audio attachment (stored on user messages). */
export interface DocumentAttachment {
  id: string;
  /** Original filename. */
  name: string;
  /** "document" or "audio". */
  kind: "document" | "audio";
  /** File extension (pdf, docx, mp3, …). */
  ext: string;
  /** Human label (PDF, Word, MP3, …). */
  label: string;
  /** Servable URL (/api/uploads?id=…). */
  url: string;
}

/** SSE events streamed from POST /api/chat */
export type ChatSSEEvent =
  | { type: "session"; sessionId: string; title: string }
  | {
      type: "user_message";
      id: string;
      images?: string[];
      documents?: DocumentAttachment[];
    }
  | { type: "engine"; engine: EngineKind; model: string; note?: string }
  | {
      type: "status";
      phase:
        | "thinking"
        | "vision"
        | "reading"
        | "transcribing"
        | "tool"
        | "awaiting_approval";
      label: string;
    }
  | { type: "delta"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      state: "running" | "done" | "error" | "denied" | "blocked";
      result?: string;
      ms?: number;
    }
  | {
      type: "approval";
      approvalId: string;
      toolId: string;
      command: string;
      reason: string;
      expiresIn: number;
    }
  | {
      type: "error";
      message: string;
      kind?: "rate_limit" | "auth" | "model" | "network" | "no_key" | "unknown";
    }
  | { type: "ping" }
  | { type: "done"; messageId: string; content: string; ms: number };

export type ToolState =
  | "running"
  | "awaiting_approval"
  | "done"
  | "error"
  | "denied"
  | "blocked";

export interface ToolCard {
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: ToolState;
  result?: string;
  ms?: number;
}

export interface AssistantMeta {
  tools?: ToolCard[];
  model?: string;
  engine?: EngineKind;
  error?: string;
}

/** Meta stored on USER messages (images / documents they attached). */
export interface UserMeta {
  images?: string[];
  documents?: { id: string; name: string; kind: "document" | "audio"; ext: string; label: string }[];
}

export type ReasoningMode = "fast" | "deep" | "ultra";
export type SafetyLevel = "strict" | "standard" | "relaxed" | "unrestricted";
export type WebAccessMode = "standard" | "unrestricted";

export interface ToolPermissions {
  runCommand: boolean;
  fileAccess: boolean;
  webAccess: boolean;
  imageGen: boolean;
  systemInfo: boolean;
}

export const DEFAULT_TOOL_PERMISSIONS: ToolPermissions = {
  runCommand: true,
  fileAccess: true,
  webAccess: true,
  imageGen: true,
  systemInfo: true,
};

export interface JarvisSettings {
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
  /** User-authored system prompt — highest-priority core directives. */
  coreSystemPrompt: string;
  /** How much independent thinking the core does before answering. */
  reasoningMode: ReasoningMode;
  /** Safety policy for tool execution AND discussion/content policy. */
  safetyLevel: SafetyLevel;
  /** Web access depth: unrestricted = more results, longer reads, no truncation. */
  webAccessMode: WebAccessMode;
  /** Per-tool enable/disable switches (disabled tools are removed from the AI's toolset). */
  toolPermissions: ToolPermissions;
  /** Active AI provider: "zai" (SDK native engine), a preset id, or "custom:<n>". */
  aiProvider: string;
  /** Resolved OpenAI-compatible base URL (empty for native z.ai). */
  aiBaseUrl: string;
  /** API key for the active provider — stored server-side only, never returned to clients. */
  aiApiKey: string;
  /** Chat model id (empty = provider default / native engine). */
  aiModel: string;
  /** Vision model id for image analysis (empty = image input unavailable). */
  aiVisionModel: string;
  /** ASR model id for audio transcription (empty = SDK default). */
  aiAsrModel: string;
  /** User-defined OpenAI-compatible providers. */
  customProviders: CustomProvider[];
}

export interface CustomProvider {
  /** Stable id: "custom:<slug>". */
  id: string;
  name: string;
  /** OpenAI-compatible base URL, e.g. https://host/v1 */
  baseUrl: string;
}

export const DEFAULT_SETTINGS: JarvisSettings = {
  speakResponses: true,
  autoSendVoice: true,
  wakeWord: false,
  voiceRate: 1.05,
  voicePitch: 0.9,
  voiceUri: "",
  userName: "sir",
  customInstructions: "",
  responseStyle: "balanced",
  micDeviceId: "",
  sttLang: "en-US",
  coreSystemPrompt: "",
  reasoningMode: "ultra",
  safetyLevel: "standard",
  webAccessMode: "unrestricted",
  toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS },
  aiProvider: "zai",
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "",
  aiVisionModel: "",
  aiAsrModel: "",
  customProviders: [],
};

// ─── Client-side shapes ──────────────────────────────────────────────────────

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCard[];
  streaming?: boolean;
  error?: string;
  engine?: EngineKind;
  /** Attached image URLs (user messages) — e.g. /api/uploads?id=upl_xxx */
  images?: string[];
  /** Attached documents/audio (user messages). */
  documents?: DocumentAttachment[];
  createdAt: number;
}

export interface ApprovalRequest {
  approvalId: string;
  toolId: string;
  command: string;
  reason: string;
  expiresAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview?: string | null;
}

export interface ActivityEntry {
  id: string;
  time: number;
  kind: "tool" | "approval" | "error" | "info";
  text: string;
  detail?: string;
  state?: ToolState;
}

export interface SystemStats {
  hostname: string;
  platform: string;
  arch: string;
  osVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuUsage: number;
  loadAvg: number[];
  memTotal: number;
  memUsed: number;
  memPct: number;
  diskTotal: number;
  diskUsed: number;
  diskPct: number;
  uptime: number;
  processes: number;
  ip: string;
  runtime: string;
  timestamp: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export const TOOL_LABELS: Record<string, string> = {
  run_command: "Terminal",
  list_files: "Filesystem",
  read_file: "Filesystem",
  write_file: "Filesystem",
  web_search: "Web search",
  read_web_page: "Web reader",
  system_info: "Telemetry",
  generate_image: "Image forge",
};
