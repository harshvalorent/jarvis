import fs from "node:fs/promises";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import { PROJECT_ROOT } from "@/lib/paths";
import { getSettings } from "@/lib/settings";
import type { ReasoningMode } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LlmToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmResult {
  content: string;
  toolCalls: ToolCall[];
}

export type LlmErrorKind =
  | "rate_limit"
  | "auth"
  | "model"
  | "network"
  | "no_key"
  | "unknown";

export class LlmError extends Error {
  kind: LlmErrorKind;
  status?: number;
  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// ─── SDK instance (single shared instance) ───────────────────────────────────

type ZaiInstance = Awaited<ReturnType<typeof ZAI.create>>;
let zaiInstance: ZaiInstance | null = null;
let zaiPromise: Promise<ZaiInstance> | null = null;

async function getZai(): Promise<ZaiInstance> {
  if (zaiInstance) return zaiInstance;
  if (!zaiPromise) {
    zaiPromise = ZAI.create().then((inst: ZaiInstance) => {
      zaiInstance = inst;
      return inst;
    });
  }
  return zaiPromise;
}

// ─── Resilient retry with exponential backoff ────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits (in ms) before retry N — 2s, 5s, 10s, 20s with ±25% jitter. */
function backoffMs(attempt: number): number {
  const base = Math.min(2000 * 2 ** (attempt - 1), 20000);
  const jitter = base * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}

interface ZaiConfigExtras {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  visionModel?: string;
  asrModel?: string;
}

let zaiCfgExtras: ZaiConfigExtras | null | undefined;

/**
 * Active AI-core connection details, resolved in priority order:
 * 1. DB settings (aiProvider/aiBaseUrl/aiApiKey — configured from the Settings UI)
 * 2. The .z-ai-config file (hand-edited setup)
 * A non-null result with a "model" field means a generic OpenAI-compatible
 * provider (model is caller-supplied); null or no model means the native
 * Z.ai SDK engine.
 */
export async function getZaiConfigExtras(): Promise<ZaiConfigExtras | null> {
  if (zaiCfgExtras !== undefined) return zaiCfgExtras;
  try {
    const settings = await getSettings().catch(() => null);
    if (
      settings &&
      settings.aiProvider &&
      settings.aiProvider !== "zai" &&
      settings.aiBaseUrl &&
      settings.aiApiKey
    ) {
      zaiCfgExtras = {
        baseUrl: settings.aiBaseUrl,
        apiKey: settings.aiApiKey,
        model: settings.aiModel || undefined,
        visionModel: settings.aiVisionModel || undefined,
        asrModel: settings.aiAsrModel || undefined,
      };
      return zaiCfgExtras;
    }
  } catch {
    // fall through to the .z-ai-config file
  }
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, ".z-ai-config"), "utf8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    zaiCfgExtras = {
      baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : undefined,
      apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : undefined,
      model: typeof cfg.model === "string" ? cfg.model : undefined,
      visionModel: typeof cfg.visionModel === "string" ? cfg.visionModel : undefined,
      asrModel: typeof cfg.asrModel === "string" ? cfg.asrModel : undefined,
    };
  } catch {
    zaiCfgExtras = null;
  }
  return zaiCfgExtras;
}

/** Drops the cached AI-core config so the next call re-reads settings. */
export function invalidateZaiConfigCache(): void {
  zaiCfgExtras = undefined;
}

/** Classify raw SDK/API errors. */
function classifyError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const msg = (e as Error)?.message ?? String(e);
  if (/configuration file not found/i.test(msg)) {
    return new LlmError(
      "auth",
      "AI core is not configured: create a .z-ai-config file (JSON with baseUrl ending in /v1 and an apiKey) in the project folder or your home folder."
    );
  }
  if (/\bstatus 404\b|does not exist or you do not have access/i.test(msg)) {
    return new LlmError(
      "model",
      `The configured AI provider does not offer that model or capability: ${msg.slice(0, 160)}`
    );
  }
  if (/\bstatus 429\b|too many requests/i.test(msg)) {
    return new LlmError(
      "rate_limit",
      "The AI core is rate-limited right now (too many requests). It will retry automatically.",
      429
    );
  }
  if (/\bstatus 40[13]\b|unauthorized|forbidden/i.test(msg)) {
    return new LlmError("auth", `Core rejected the request: ${msg.slice(0, 200)}`);
  }
  if (/\bstatus 5\d\d\b|server error/i.test(msg)) {
    return new LlmError("network", `Core service error: ${msg.slice(0, 200)}`);
  }
  return new LlmError("unknown", msg.slice(0, 300));
}

/**
 * Run an SDK operation with automatic retry on rate limits (429) and
 * transient server/network faults. `onRetry` lets callers surface
 * "retrying…" status to the user instead of a dead stream.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  opts: {
    attempts?: number;
    signal?: AbortSignal;
    onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void;
  } = {}
): Promise<T> {
  const attempts = Math.min(Math.max(opts.attempts ?? 4, 1), 6);
  let lastError: LlmError = new LlmError("unknown", "no attempt made");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await op();
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastError = classifyError(e);
      const retryable =
        lastError.kind === "rate_limit" ||
        lastError.kind === "network" ||
        lastError.kind === "unknown";
      if (attempt >= attempts || !retryable) break;
      const waitMs = backoffMs(attempt);
      opts.onRetry?.({ attempt, total: attempts, waitMs });
      await sleep(waitMs);
    }
  }
  // Distinguish “will retry” from “already retried and stayed busy” for the user.
  if (lastError.kind === "rate_limit" && attempts > 1) {
    throw new LlmError(
      "rate_limit",
      `The AI core stayed rate-limited after ${attempts} automatic retries. Please send your message again in a moment — your conversation is saved.`,
      429
    );
  }
  throw lastError;
}

// ─── Simulated streaming (engine returns full responses in one shot) ─────────

function simulateStream(text: string, onDelta?: (t: string) => void) {
  if (!onDelta || !text) return;
  const chunks = Math.min(120, Math.max(1, Math.ceil(text.length / 24)));
  const size = Math.ceil(text.length / chunks);
  for (let i = 0; i < text.length; i += size) {
    onDelta(text.slice(i, i + size));
  }
}

// ─── The JARVIS core (built-in engine, no API keys, tool calling) ────────────

interface CompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }[];
}

/**
 * Deep-reasoning toggle: fast = plain completion; deep/ultra = chain-of-thought
 * enabled on the engine side for substantially stronger multi-step reasoning.
 */
export function thinkingEnabledFor(mode: ReasoningMode): boolean {
  return mode === "deep" || mode === "ultra";
}

export async function callCore(opts: {
  reasoningMode: ReasoningMode;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void;
}): Promise<LlmResult> {
  let zai: ZaiInstance;
  try {
    zai = await getZai();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/configuration file not found/i.test(msg)) {
      throw new LlmError(
        "auth",
        "AI core is not configured: create a .z-ai-config file (JSON with baseUrl ending in /v1 and an apiKey) in the project folder or your home folder."
      );
    }
    throw new LlmError("network", "AI core failed to initialize.");
  }

  const cfg = await getZaiConfigExtras();
  const payload: Record<string, unknown> = {
    messages: opts.messages,
    temperature: 0.65,
  };
  if (cfg?.model && cfg?.baseUrl) {
    payload.model = cfg.model;
    if (/^openai\/gpt-oss/.test(cfg.model)) {
      payload.reasoning_effort = thinkingEnabledFor(opts.reasoningMode)
        ? "high"
        : "low";
    }
    if (opts.tools.length) {
      payload.tools = opts.tools;
      payload.tool_choice = "auto";
    }
  } else {
    payload.thinking = {
      type: thinkingEnabledFor(opts.reasoningMode) ? "enabled" : "disabled",
    };
    if (opts.tools.length) {
      payload.tools = opts.tools;
      payload.tool_choice = "auto";
    }
  }

  const sendViaSdk = () =>
    zai.chat.completions.create(payload as never) as Promise<CompletionResponse>;
  const sendViaProvider = async (): Promise<CompletionResponse> => {
    const res = await fetch(`${cfg?.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg?.apiKey ?? ""}`,
      },
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new Error(
        `API request failed with status ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
    return (await res.json()) as CompletionResponse;
  };

  const completion = await withRetry(
    cfg?.model && cfg?.baseUrl ? sendViaProvider : sendViaSdk,
    {
      attempts: 6,
      signal: opts.signal,
      onRetry: opts.onRetry,
    }
  );

  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const message = completion.choices?.[0]?.message;
  const content = (message?.content ?? "").replace(/^\n+/, "");
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id || `call_core_${Date.now()}_${i}`,
    type: "function" as const,
    function: {
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments || "{}",
    },
  }));

  simulateStream(content, opts.onDelta);
  return { content, toolCalls };
}

// ─── Vision subsystem (multimodal image understanding) ───────────────────────

export interface VisionPart {
  type: "image_url";
  image_url: { url: string };
}

/**
 * Analyze attached images with the vision model. Returns a detailed factual
 * report (OCR, objects, colors, layout) that the reasoning core uses as
 * ground-truth context for its answer.
 */
export async function analyzeImages(opts: {
  dataUris: string[];
  userText: string;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void;
}): Promise<string> {
  let zai: ZaiInstance;
  try {
    zai = await getZai();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/configuration file not found/i.test(msg)) {
      throw new LlmError(
        "auth",
        "Vision subsystem is not configured: create a .z-ai-config file (JSON with baseUrl ending in /v1 and an apiKey) in the project folder or your home folder."
      );
    }
    throw new LlmError("network", "Vision subsystem failed to initialize.");
  }

  const content: Array<
    { type: "text"; text: string } | VisionPart
  > = [
    {
      type: "text",
      text: `You are the VISION subsystem of J.A.R.V.I.S. The user attached ${opts.dataUris.length} image(s) to their message. Produce an exhaustive, precise factual report about the image(s) — the reasoning core will use it as ground truth.

Report structure:
1. IMAGE TYPE: photo / screenshot / artwork / diagram / document / meme / other.
2. CONTENT: every key object, person, and scene element. Transcribe ALL visible text EXACTLY as written (OCR) — labels, UI text, numbers, watermarks.
3. DETAILS: colors, layout, style, quality, notable relationships between elements.
4. ${opts.dataUris.length > 1 ? "PER IMAGE: describe each image separately (Image 1, Image 2, …), then compare/contrast them." : "RELEVANCE: anything noteworthy for answering questions about this image."}

Be factual and complete. Do not guess beyond what is visible.

User's message: "${opts.userText.slice(0, 2000) || "(no text — describe the image)"}"`,
    },
    ...opts.dataUris.map(
      (url): VisionPart => ({ type: "image_url", image_url: { url } })
    ),
  ];

  const cfgExtras = await getZaiConfigExtras();

  if (cfgExtras?.model && !cfgExtras.visionModel) {
    throw new LlmError(
      "model",
      "The configured AI provider has no image-analysis model for this key — image understanding is unavailable. Remove the image, or select a Vision model in Settings → AI Provider & Models."
    );
  }

  const visionBody = cfgExtras?.visionModel
    ? {
        model: cfgExtras.visionModel,
        messages: [{ role: "user", content }],
      }
    : {
        messages: [{ role: "user", content }],
        thinking: { type: "disabled" } as const,
      };

  const providerVision =
    Boolean(cfgExtras?.visionModel) &&
    Boolean(cfgExtras?.baseUrl) &&
    Boolean(cfgExtras?.apiKey);

  const callVision = async (): Promise<CompletionResponse> => {
    if (providerVision) {
      const res = await fetch(`${cfgExtras?.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfgExtras?.apiKey ?? ""}`,
        },
        body: JSON.stringify(visionBody),
        signal: opts.signal,
      });
      if (!res.ok) {
        throw new Error(
          `API request failed with status ${res.status}: ${(await res.text()).slice(0, 300)}`
        );
      }
      return (await res.json()) as CompletionResponse;
    }
    const instance = providerVision ? zai : await getZai();
    return (cfgExtras?.visionModel
      ? instance.chat.completions.create(visionBody as never)
      : instance.chat.completions.createVision(visionBody as never)) as Promise<CompletionResponse>;
  };

  const response = await withRetry(callVision, {
    attempts: 3,
    signal: opts.signal,
    onRetry: opts.onRetry,
  });

  const out = (response.choices?.[0]?.message?.content ?? "").trim();
  if (!out) throw new LlmError("unknown", "Vision analysis returned no content.");
  return out;
}
