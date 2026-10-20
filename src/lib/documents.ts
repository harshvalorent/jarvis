import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import { withRetry, getZaiConfigExtras } from "@/lib/llm";
import { MAX_DOC_CHARS } from "@/lib/doc-limits";
import { DATA_TMP_DIR } from "@/lib/paths";

const execAsync = promisify(exec);

export {
  ATTACH_ACCEPT,
  AUDIO_EXT_TO_MIME,
  AUDIO_MIME_TO_EXT,
  AUDIO_SPECS,
  DOC_EXT_TO_MIME,
  DOC_MIME_TO_EXT,
  DOC_SPECS,
  IMAGE_SPECS,
  MAX_FILE_BYTES,
  MAX_UPLOAD_AUDIO,
  MAX_UPLOAD_DOCS,
  labelForExt,
} from "@/lib/attachment-specs";
export type { DocSpec, UploadKind } from "@/lib/attachment-specs";

// ─── Extraction helpers ──────────────────────────────────────────────────────

function clampText(text: string): string {
  const t = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (t.length <= MAX_DOC_CHARS) return t;
  return `${t.slice(0, MAX_DOC_CHARS)}\n…[document truncated — ${t.length.toLocaleString()} chars total, first ${MAX_DOC_CHARS.toLocaleString()} shown]`;
}

async function run(cmd: string, timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execAsync(cmd, {
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout ?? "";
}

/** Extract text from a slide XML blob (PowerPoint `<a:t>` runs). */
function xmlText(xml: string): string {
  const runs = xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [];
  return runs
    .map((r) => r.slice(5, -6))
    .map((s) =>
      s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

async function zipSlideTexts(buffer: Buffer): Promise<string[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(
      (a, b) =>
        parseInt(a.match(/(\d+)\.xml$/)?.[1] ?? "0", 10) -
        parseInt(b.match(/(\d+)\.xml$/)?.[1] ?? "0", 10)
    );
  const parts: string[] = [];
  for (const [i, name] of names.entries()) {
    const xml = await zip.files[name].async("string");
    const text = xmlText(xml);
    if (text) parts.push(`[Slide ${i + 1}]\n${text}`);
  }
  return parts;
}

async function odtText(buffer: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const content = zip.file("content.xml");
  if (!content) return "";
  const xml = await content.async("string");
  return xml
    .replace(/<\/text:(p|h)(\s[^>]*)?>/g, "\n")
    .replace(/<text:tab\s*\/>/g, "\t")
    .replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .split("\n")
    .map((p) => p.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function epubText(buffer: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /\.(xhtml|html|htm)$/i.test(n) && !/(^|\/)cover/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts: string[] = [];
  for (const name of names) {
    const text = stripTags(await zip.files[name].async("string"));
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function rtfToText(buffer: Buffer): string {
  let raw = buffer.toString("latin1");
  raw = raw.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  raw = raw.replace(/\{\\\*?(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/g, " ");
  raw = raw.replace(/\\par[d]?\b/g, "\n");
  raw = raw.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  raw = raw.replace(/[{}]/g, "");
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Document text extraction ────────────────────────────────────────────────

export interface ExtractedDoc {
  text: string;
  method: string;
}

/**
 * Extract the text content of any supported document.
 * Strategy: fast system tools (pdftotext / pandoc / unzip) with npm-library
 * fallbacks (pdf-parse / mammoth / xlsx). Never throws for unsupported —
 * returns an error note the core can relay honestly.
 */
export async function extractDocumentText(
  buffer: Buffer,
  ext: string
): Promise<ExtractedDoc> {
  try {
    switch (ext) {
      case "pdf": {
        // primary: pdftotext (poppler) — fast and layout-accurate
        try {
          const tmp = path.join(DATA_TMP_DIR, `jv_${Date.now()}.pdf`);
          await fs.writeFile(tmp, buffer);
          try {
            const text = await run(`pdftotext -layout ${JSON.stringify(tmp)} -`);
            if (text.trim()) return { text: clampText(text), method: "pdftotext" };
          } finally {
            await fs.rm(tmp, { force: true });
          }
        } catch {
          // fall through to unpdf
        }
        // fallback: unpdf (pure JS, serverless-safe — no pdfjs worker resolution issues)
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text: rawText } = await extractText(pdf, { mergePages: true });
        const pdfText = (rawText ?? "").replace(/\s+-\s*\d+\s*-\s*$/gm, "").trim();
        if (pdfText) return { text: clampText(pdfText), method: "unpdf" };
        return {
          text: "(PDF has no extractable text layer — it may be a scanned/image PDF. Ask the user to attach page screenshots as images instead.)",
          method: "none",
        };
      }

      case "docx": {
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          if (result.value.trim()) return { text: clampText(result.value), method: "mammoth" };
        } catch {
          // fall through to pandoc
        }
        return await pandocExtract(buffer, "docx");
      }

      case "pptx": {
        const slides = await zipSlideTexts(buffer);
        if (slides.length) {
          return { text: clampText(slides.join("\n\n")), method: "jszip+xml" };
        }
        return { text: "(no slide text found)", method: "none" };
      }

      case "xlsx":
      case "ods": {
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buffer, { type: "buffer" });
          const parts: string[] = [];
          for (const name of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            if (csv.trim()) parts.push(`[Sheet: ${name}]\n${csv}`);
          }
          if (parts.length) {
            return { text: clampText(parts.join("\n\n")), method: "xlsx" };
          }
        } catch {
          // ignore
        }
        return { text: "(no sheet data found)", method: "none" };
      }

      case "odt":
      case "rtf":
      case "epub":
        return await pandocExtractOrFallback(buffer, ext);

      default: {
        // plain text / code / data files — decode directly
        const text = buffer.toString("utf8");
        if (text.trim()) return { text: clampText(text), method: "utf8" };
        return { text: "(file appears to be binary or empty)", method: "none" };
      }
    }
  } catch (e) {
    return {
      text: `(extraction failed: ${(e as Error).message?.slice(0, 200)})`,
      method: "error",
    };
  }
}

/** pandoc-based extraction for pandoc-readable formats. */
async function pandocExtractOrFallback(buffer: Buffer, ext: string): Promise<ExtractedDoc> {
  try {
    return await pandocExtract(buffer, ext);
  } catch {
    if (ext === "odt") {
      const text = await odtText(buffer);
      return text
        ? { text: clampText(text), method: "jszip-xml" }
        : { text: "(no text content found)", method: "none" };
    }
    if (ext === "epub") {
      const text = await epubText(buffer);
      return text
        ? { text: clampText(text), method: "jszip-xml" }
        : { text: "(no text content found)", method: "none" };
    }
    if (ext === "rtf") {
      const text = rtfToText(buffer);
      return text
        ? { text: clampText(text), method: "rtf-parse" }
        : { text: "(no text content found)", method: "none" };
    }
    throw new Error(`no JS fallback extractor for .${ext}`);
  }
}

async function pandocExtract(buffer: Buffer, ext: string): Promise<ExtractedDoc> {
  const tmp = path.join(DATA_TMP_DIR, `jv_${Date.now()}.${ext}`);
  await fs.writeFile(tmp, buffer);
  try {
    const text = await run(
      `pandoc -f ${ext} -t plain --wrap=none ${JSON.stringify(tmp)}`,
      30_000
    );
    if (text.trim()) return { text: clampText(text), method: "pandoc" };
    return { text: "(no text content found)", method: "none" };
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

// ─── Audio transcription (ASR) ───────────────────────────────────────────────

type ZaiInstance = Awaited<ReturnType<typeof ZAI.create>>;
let zaiInstance: ZaiInstance | null = null;
async function getZai(): Promise<ZaiInstance> {
  if (!zaiInstance) zaiInstance = await ZAI.create();
  return zaiInstance;
}

/**
 * Transcribe an audio file (mp3/wav/m4a/flac/ogg/…) to text.
 * When .z-ai-config sets asrModel (+baseUrl), posts multipart to the provider's
 * OpenAI-compatible /audio/transcriptions endpoint; otherwise uses the Z.ai SDK's
 * base64 /audio/asr route.
 */
export async function transcribeAudio(
  buffer: Buffer,
  opts: {
    ext?: string;
    signal?: AbortSignal;
    onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void;
  } = {}
): Promise<string> {
  const cfg = await getZaiConfigExtras();

  if (cfg?.asrModel && cfg?.baseUrl) {
    try {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(buffer)]),
        `audio.${opts.ext ?? "wav"}`
      );
      form.append("model", cfg.asrModel);
      const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey ?? ""}` },
        body: form,
        signal: opts.signal,
      });
      if (!res.ok) {
        throw new Error(
          `ASR request failed with status ${res.status}: ${(await res.text()).slice(0, 200)}`
        );
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) return text;
    } catch (e) {
      // providers often lack an ASR endpoint (e.g. OpenRouter) — fall back to the native engine
      if (opts.signal?.aborted) throw e;
    }
  }

  const groqKey = (await getSettings().catch(() => null))?.groqApiKey;
  if (groqKey) {
    try {
      const form2 = new FormData();
      form2.append(
        "file",
        new Blob([new Uint8Array(buffer)]),
        `audio.${opts.ext ?? "wav"}`
      );
      form2.append("model", "whisper-large-v3");
      const res2 = await fetch(`${presetById("groq")!.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}` },
        body: form2,
        signal: opts.signal,
      });
      if (!res2.ok) {
        throw new Error(`Groq ASR failed with status ${res2.status}`);
      }
      const data2 = (await res2.json()) as { text?: string };
      const text2 = (data2.text ?? "").trim();
      if (text2) return text2;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
    }
  }

  const zai = await getZai();
  const response = await withRetry(
    () =>
      zai.audio.asr.create({
        file_base64: buffer.toString("base64"),
      }) as Promise<{ text?: string }>,
    { attempts: 3, signal: opts.signal, onRetry: opts.onRetry }
  );
  const text = (response?.text ?? "").trim();
  if (!text) throw new Error("ASR returned an empty transcript.");
  return text;
}
