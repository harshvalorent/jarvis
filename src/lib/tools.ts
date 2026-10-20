import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";
import type { LlmToolDef } from "@/lib/llm";
import { withRetry } from "@/lib/llm";
import { getSystemStats } from "@/lib/system";
import { getSettings } from "@/lib/settings";
import {
  HOME_ROOT,
  IS_WINDOWS,
  SHELL,
  SHELL_NAME,
  WRITE_ROOTS,
  WORKSPACE,
  GENERATED_IMAGES_DIR,
  USER_UPLOADS_DIR,
  isInsideRoot,
  mapSandboxPath,
} from "@/lib/paths";

export { GENERATED_IMAGES_DIR, USER_UPLOADS_DIR };

const execAsync = promisify(exec);

/** Allowed image mime types for user uploads. */
export const UPLOAD_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_UPLOAD_IMAGES = 4;
/** Max base64 length per image (~6 MB binary ≈ 8 MB base64). */
export const MAX_IMAGE_BASE64 = 8_000_000;

const MAX_OUTPUT = 4000;

function truncate(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[output truncated, ${text.length - max} more chars]`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

// ─── Command safety classification ───────────────────────────────────────────

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\brm\s+[^|;&]*\s+\/(\s|$)/, // rm -rf /
  /\brm\s+[^|;&]*\s+\/\*/,
  /:\(\)\s*\{.*\}\s*;\s*:/, // fork bomb
  /\b(shutdown|reboot|halt|poweroff|init\s+0)\b/,
  /\b(stop|restart)-computer\b/i, // PowerShell equivalents of shutdown/reboot
  /\bmkfs\b/,
  /\bdd\b[^|;&]*of=\/dev\//,
  /\bchmod\s+-R\s+777\s+\/(\s|$)/,
  /\bmv\s+\/(\s|\*)/,
  />\s*\/dev\/sd[a-z]/,
  /\bformat\s+[a-zA-Z]:\s*$/i, // format C: etc. on Windows
];

const DANGEROUS_CMDS = new Set([
  "rm",
  "sudo",
  "dd",
  "kill",
  "killall",
  "pkill",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "pip",
  "pip3",
  "truncate",
  "shred",
  "fdisk",
  "parted",
  "visudo",
  "passwd",
  "userdel",
  "usermod",
  // Windows / PowerShell equivalents
  "remove-item",
  "remove-service",
  "stop-process",
  "stop-service",
  "stop-computer",
  "set-executionpolicy",
  "clear-content",
  "cipher",
  "reg",
  "del",
  "erase",
  "rd",
  "format",
]);

const DANGEROUS_PATTERNS: RegExp[] = [
  /(curl|wget)[^|;&]*\|\s*(ba|z|fi)?sh\b/, // pipe download into shell
  /\bgit\s+(push|reset\s+--hard|clean\s+-fd)\b/,
  /\b(chmod|chown)\b[^|;&]*(\/etc|\/usr|\/var|\/bin|\/sbin|\/boot|\/opt|\/root)\b/,
  />\s*(\/etc|\/usr|\/var|\/bin|\/sbin|\/boot|\/root|\/dev\/sd)[a-z/]/,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/,
  /\breg\s+(delete|restore)\b/i, // registry removal/restore
  /\b(reg|new-itemproperty|set-itemproperty)\b[^|;&]*(hklm|hkcu)/i, // machine/user hive writes
  /\bnet\s+user\b[^|;&]*(\/add|\/delete)\b/i,
];

/** Medium risk: state-changing operations that don't destroy data outright. */
const MEDIUM_PATTERNS: RegExp[] = [
  /\b(git\s+push|git\s+clone|git\s+pull)\b/,
  /\b(curl|wget)\b/, // downloads (without pipe-to-shell, which is dangerous)
  /\bnpm\s+(install|i|uninstall|update)\b/,
  /\bbun\s+(add|remove|install)\b/,
  /\b(docker|systemctl|service)\s+(start|stop|restart|run)\b/,
  /\bcrontab\b/,
  /\bchmod\b(?!.*\/etc|.*\/usr|.*\/var|.*\/bin)/,
  /\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b/i, // PowerShell downloads
  /\bschtasks\b/i, // scheduled tasks
  /\b(start-process|start-service|restart-service|net\s+start|net\s+stop)\b/i,
];

/**
 * Four-tier danger classification:
 *  - "forbidden"  catastrophic (disk wipe, fork bomb…) — ALWAYS hard-blocked
 *  - "high"       destructive (rm, sudo, kill, package managers…)
 *  - "medium"    state-changing (downloads, git push, installs, services…)
 *  - "low"       read-only / routine
 * Which tiers require user approval is decided by the safetyLevel setting.
 */
export type DangerLevel = "low" | "medium" | "high" | "forbidden";

export function classifyCommand(cmd: string): DangerLevel {
  const normalized = cmd.trim();
  if (FORBIDDEN_PATTERNS.some((re) => re.test(normalized))) return "forbidden";
  if (DANGEROUS_PATTERNS.some((re) => re.test(normalized))) return "high";
  const segments = normalized.split(/&&|\|\||;|\|/g);
  for (const seg of segments) {
    const m = seg.trim().match(/^([a-z0-9_.\-/]+)/i);
    const firstWord = (m?.[1] ?? "").split("/").pop()?.toLowerCase() ?? "";
    if (firstWord && DANGEROUS_CMDS.has(firstWord)) return "high";
  }
  if (MEDIUM_PATTERNS.some((re) => re.test(normalized))) return "medium";
  return "low";
}

export function dangerReason(cmd: string): string {
  if (/\b(rm|truncate|shred|remove-item|clear-content|del|erase|rd)\b/i.test(cmd)) return "Deletes data";
  if (/\b(sudo|apt|yum|dnf|passwd|visudo|usermod|userdel|set-executionpolicy)\b/i.test(cmd))
    return "System-level change";
  if (/\b(kill|killall|pkill|stop-process)\b/i.test(cmd)) return "Terminates processes";
  if (/\b(stop-service|remove-service|format|cipher|reg|net\s+user)\b/i.test(cmd))
    return "Modifies system/services";
  if (/\bgit\s+(push|reset|clean)\b/.test(cmd)) return "Destructive git operation";
  if (/(curl|wget)[^|]*\|/.test(cmd)) return "Downloads and executes remote code";
  if (/\b(chmod|chown|dd|fdisk|parted)\b/.test(cmd)) return "Modifies system/files";
  return "Potentially destructive operation";
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function resolvePath(p: string | undefined, base: string): string {
  if (!p || !p.trim()) return base;
  const mapped = mapSandboxPath(p.trim());
  return path.resolve(mapped.startsWith("/") ? mapped : path.join(base, mapped));
}

async function safeRealPath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

// ─── Tool executors ──────────────────────────────────────────────────────────

async function runCommand(args: {
  command?: string;
  timeout_seconds?: number;
}): Promise<string> {
  const command = (args.command ?? "").trim();
  if (!command) return "ERROR: no command provided.";
  const timeout = Math.min(Math.max(1, Math.round(args.timeout_seconds ?? 30)), 60);
  const started = Date.now();

  const env = { ...process.env } as Record<string, string | undefined>;
  for (const k of Object.keys(env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(k)) delete env[k];
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: WORKSPACE,
      timeout: timeout * 1000,
      maxBuffer: 512 * 1024,
      env: env as NodeJS.ProcessEnv,
      shell: SHELL,
    });
    const ms = Date.now() - started;
    const out = stdout.toString().trim();
    const err = stderr.toString().trim();
    let report = `$ ${command}\n(exit 0, ${ms}ms)`;
    if (out) report += `\n--- stdout ---\n${out}`;
    if (err) report += `\n--- stderr ---\n${err}`;
    if (!out && !err) report += `\n(no output)`;
    return truncate(report);
  } catch (e) {
    const err = e as {
      killed?: boolean;
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const ms = Date.now() - started;
    const out = (err.stdout ?? "").toString().trim();
    const errorMsg = (err.stderr ?? err.message ?? "").toString().trim();
    let report = `$ ${command}\n(exit ${err.code ?? "?"}, ${ms}ms${err.killed ? ", timed out" : ""})`;
    if (out) report += `\n--- stdout ---\n${out}`;
    report += `\n--- stderr ---\n${errorMsg || "(none)"}`;
    return truncate(report);
  }
}

async function listFiles(args: { path?: string }): Promise<string> {
  const target = resolvePath(args.path, WORKSPACE);
  const real = await safeRealPath(target);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(real, { withFileTypes: true });
  } catch (e) {
    return `ERROR: cannot list ${target} — ${(e as Error).message}`;
  }
  const items = await Promise.all(
    entries.slice(0, 500).map(async (entry) => {
      const full = path.join(real, entry.name);
      let size = 0;
      let mtime = "";
      try {
        const st = await fs.stat(full);
        size = st.size;
        mtime = st.mtime.toISOString().slice(0, 16).replace("T", " ");
      } catch {
        /* broken symlink etc. */
      }
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        isLink: entry.isSymbolicLink(),
        size,
        mtime,
      };
    })
  );
  items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const lines = items.map((i) =>
    i.isDir
      ? `DIR   ${i.name}/`
      : `FILE  ${i.name}  ${formatBytes(i.size)}  ${i.mtime}`
  );
  let report = `${real} — ${items.length} items${entries.length > 500 ? " (first 500)" : ""}`;
  if (lines.length) report += `\n${lines.join("\n")}`;
  return truncate(report);
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip",
  ".gz", ".tar", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".exe", ".dll",
  ".so", ".dylib", ".bin", ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".ogg", ".webm", ".db",
  ".sqlite", ".class", ".jar", ".wasm", ".node", ".lockb",
]);

async function readAFile(args: {
  path?: string;
  start_line?: number;
  max_lines?: number;
}): Promise<string> {
  const target = resolvePath(args.path, WORKSPACE);
  const real = await safeRealPath(target);
  try {
    const st = await fs.stat(real);
    if (!st.isFile()) return `ERROR: ${target} is not a regular file.`;
    if (BINARY_EXTENSIONS.has(path.extname(real).toLowerCase())) {
      return `${real}: binary file (${formatBytes(st.size)}, ${path.extname(real)}). Cannot display as text.`;
    }
    if (st.size > 2 * 1024 * 1024) {
      return `ERROR: ${path} is ${formatBytes(st.size)} — too large. Use run_command with ${IS_WINDOWS ? "Get-Content/Select-String (PowerShell)" : "head/tail/grep"} to inspect parts of it.`;
    }
    const raw = await fs.readFile(real, "utf8");
    const allLines = raw.split("\n");
    const total = allLines.length;
    const start = Math.max(1, Math.round(args.start_line ?? 1));
    const maxLines = Math.min(Math.max(10, Math.round(args.max_lines ?? 300)), 1000);
    const slice = allLines.slice(start - 1, start - 1 + maxLines);
    const numbered = slice.map((l, i) => `${String(start + i).padStart(4)} | ${l}`).join("\n");
    let report = `${real} (lines ${start}–${start - 1 + slice.length} of ${total}, ${formatBytes(st.size)})`;
    if (start > 1) report += ` — earlier lines omitted`;
    report += `\n${numbered}`;
    if (start - 1 + slice.length < total) {
      report += `\n… (${total - (start - 1 + slice.length)} more lines — call again with start_line=${start + maxLines})`;
    }
    return truncate(report, 6000);
  } catch (e) {
    return `ERROR: cannot read ${target} — ${(e as Error).message}`;
  }
}

async function writeAFile(args: {
  path?: string;
  content?: string;
  create_directories?: boolean;
}): Promise<string> {
  const target = resolvePath(args.path, WORKSPACE);
  const real = await safeRealPath(path.dirname(target));
  if (!isInsideRoot(real, WRITE_ROOTS)) {
    return `ERROR: writes are restricted to the project folder (${WORKSPACE}) and your user folder (${HOME_ROOT}) for safety. Requested: ${target}`;
  }
  const content = args.content ?? "";
  try {
    if (args.create_directories !== false) {
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    await fs.writeFile(target, content, "utf8");
    const st = await fs.stat(target);
    return `Wrote ${formatBytes(st.size)} (${content.split("\n").length} lines) to ${target}`;
  } catch (e) {
    return `ERROR: cannot write ${target} — ${(e as Error).message}`;
  }
}

let zaiToolsInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getZai() {
  if (!zaiToolsInstance) zaiToolsInstance = await ZAI.create();
  return zaiToolsInstance;
}

interface SearchResultItem {
  url?: string;
  name?: string;
  snippet?: string;
  host_name?: string;
  date?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Fallback search via DuckDuckGo's HTML endpoint — works on any machine, no API key. */
async function duckDuckGoSearch(
  query: string,
  num: number,
  limit = 5000,
  snippetLen = 220
): Promise<string> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`DuckDuckGo responded ${res.status}`);
  const html = await res.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const linkRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRegex.exec(html)) !== null) snippets.push(stripHtml(sm[1]));
  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRegex.exec(html)) !== null && results.length < num) {
    let href = lm[1];
    if (href.startsWith("//")) href = `https:${href}`;
    let target = href;
    try {
      const u = new URL(href);
      const uddg = u.searchParams.get("uddg");
      if (uddg) target = uddg;
    } catch {
      // keep raw href
    }
    results.push({
      title: stripHtml(lm[2]) || "Untitled",
      url: target,
      snippet: snippets[i] ?? "",
    });
    i++;
  }
  if (results.length === 0) {
    return `No results found for "${query}" (fallback search).`;
  }
  const lines = results.map(
    (r, idx) => `${idx + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, snippetLen)}`
  );
  return truncate(`Search results for "${query}":\n\n${lines.join("\n\n")}`, limit);
}

/** Fallback page reader via direct HTTP fetch — works on any machine. */
async function directFetchPage(url: string, limit = 6000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "(untitled)";
  if (!contentType.includes("html") && !raw.trimStart().startsWith("<")) {
    return truncate(`TITLE: ${title}\nURL: ${url}\n\n${raw}`, limit);
  }
  const text = stripHtml(raw);
  if (!text) throw new Error("no readable content");
  return truncate(`TITLE: ${title}\nURL: ${url}\n\n${text}`, limit);
}

async function webSearch(args: { query?: string; max_results?: number }): Promise<string> {
  const query = (args.query ?? "").trim();
  if (!query) return "ERROR: no search query provided.";
  const settings = await getSettings().catch(() => null);
  const unrestricted = settings?.webAccessMode === "unrestricted";
  const num = Math.min(
    Math.max(1, Math.round(args.max_results ?? (unrestricted ? 8 : 5))),
    10
  );
  const limit = unrestricted ? 9000 : 5000;
  const snippetLen = unrestricted ? 400 : 220;
  const nativeEngine = !settings?.aiProvider || settings.aiProvider === "zai";
  let primary: string | null = null;
  if (nativeEngine) {
    try {
      const zai = await getZai();
      const results = (await withRetry(() =>
        zai.functions.invoke("web_search", {
          query,
          num,
        }) as Promise<SearchResultItem[]>
      )) as SearchResultItem[];
      if (Array.isArray(results) && results.length > 0) {
        const lines = results.map((r, i) => {
          const date = r.date && r.date !== "N/A" ? ` (${r.date})` : "";
          return `${i + 1}. ${r.name ?? "Untitled"}${date}\n   ${r.url ?? ""}\n   ${(r.snippet ?? "").slice(0, snippetLen)}`;
        });
        primary = truncate(`Search results for "${query}":\n\n${lines.join("\n\n")}`, limit);
      } else if (Array.isArray(results)) {
        primary = `No results found for "${query}".`;
      }
    } catch {
      // primary search unavailable → fallback below
    }
  }
  if (primary) return primary;
  // Fallback: DuckDuckGo HTML (used when the primary search is unavailable,
  // e.g. when self-hosting outside the Z.ai environment)
  try {
    return await duckDuckGoSearch(query, num, limit, snippetLen);
  } catch (e) {
    return `ERROR: web search failed — ${(e as Error).message}`;
  }
}

async function readWebPage(args: { url?: string }): Promise<string> {
  const url = (args.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return `ERROR: invalid URL "${url}" — must start with http(s)://`;
  const settings = await getSettings().catch(() => null);
  const unrestricted = settings?.webAccessMode === "unrestricted";
  const limit = unrestricted ? 12000 : 6000;
  const nativeEngine = !settings?.aiProvider || settings.aiProvider === "zai";
  if (nativeEngine) {
    try {
      const zai = await getZai();
      const result = (await withRetry(() =>
        zai.functions.invoke("page_reader", { url }) as Promise<{
          data?: { title?: string; html?: string; publishedTime?: string };
        }>
      )) as { data?: { title?: string; html?: string; publishedTime?: string } };
      const data = result?.data ?? {};
      const text = stripHtml(data.html ?? "");
      if (text) {
        const header = `TITLE: ${data.title ?? "(untitled)"}\nURL: ${url}${data.publishedTime ? `\nPUBLISHED: ${data.publishedTime}` : ""}\n\n`;
        return truncate(header + text, limit);
      }
    } catch {
      // fall through to direct fetch
    }
  }
  try {
    return await directFetchPage(url, limit);
  } catch (e) {
    return `ERROR: failed to read ${url} — ${(e as Error).message}`;
  }
}

async function systemInfo(): Promise<string> {
  const s = await getSystemStats();
  const fmtDuration = (sec: number) => {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const lines = [
    `Host: ${s.hostname} (${s.platform} ${s.arch}, ${s.osVersion})`,
    `CPU: ${s.cpuCores}\u00d7 ${s.cpuModel} — usage ${s.cpuUsage.toFixed(0)}%`,
    `Load (1/5/15m): ${s.loadAvg.map((l) => l.toFixed(2)).join(" / ")}`,
    `Memory: ${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)} (${s.memPct.toFixed(0)}% used)`,
    `Disk (/): ${formatBytes(s.diskUsed)} / ${formatBytes(s.diskTotal)} (${s.diskPct.toFixed(0)}% used)`,
    `Uptime: ${fmtDuration(s.uptime)}`,
    `Processes: ${s.processes}`,
    `Primary IP: ${s.ip}`,
    `Runtime: ${s.runtime}`,
  ];
  return lines.join("\n");
}

// ─── Image generation ────────────────────────────────────────────────────────

const IMAGE_SIZES = new Set([
  "1024x1024",
  "768x1344",
  "864x1152",
  "1344x768",
  "1152x864",
  "1440x720",
  "720x1440",
]);

type ImageSize =
  | "1024x1024"
  | "768x1344"
  | "864x1152"
  | "1344x768"
  | "1152x864"
  | "1440x720"
  | "720x1440";

export interface GeneratedImageInfo {
  id: string;
  url: string;
  path: string;
  prompt: string;
  size: string;
  bytes: number;
  ms: number;
}

/** Core image synthesis — saves to generated-images/ and returns a servable URL. */
export async function generateImage(args: {
  prompt?: string;
  size?: string;
  /** Surfaces rate-limit backoff waits to the chat stream ("retrying in Ns"). */
  onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void;
}): Promise<string> {
  const prompt = (args.prompt ?? "").trim();
  if (!prompt) return "ERROR: no image prompt provided.";
  if (prompt.length > 1500) return "ERROR: prompt too long (max 1500 chars).";
  let size = (args.size ?? "").trim();
  if (size && !IMAGE_SIZES.has(size)) {
    size = "1024x1024";
  }
  const finalSize: ImageSize = (size || "1024x1024") as ImageSize;

  const started = Date.now();
  try {
    await fs.mkdir(GENERATED_IMAGES_DIR, { recursive: true });
    const zai = await getZai();
    // Image synthesis is a long (~60s) operation that frequently crosses
    // rate-limit windows — give it extra retry headroom so it never "fails"
    // for the user.
    const response = await withRetry(
      () =>
        zai.images.generations.create({
          prompt,
          size: finalSize,
        }),
      { attempts: 2, onRetry: args.onRetry }
    );
    const base64 = response?.data?.[0]?.base64;
    if (!base64) return "ERROR: image generation returned no data — try again.";
    const buffer = Buffer.from(base64, "base64");
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const filePath = path.join(GENERATED_IMAGES_DIR, `${id}.png`);
    await fs.writeFile(filePath, buffer);
    const ms = Date.now() - started;
    const url = `/api/image?id=${id}`;
    return `IMAGE GENERATED SUCCESSFULLY.
Prompt: "${prompt}"
Size: ${finalSize} (${formatBytes(buffer.length)}, ${ms}ms)
Saved to: ${filePath}

You MUST embed this image in your reply using this exact markdown on its own line:
![${prompt.slice(0, 80).replace(/[[\]]/g, "")}](${url})
Briefly describe the image around it, and mention the user can ask for variations.`;
  } catch (e) {
    return `ERROR: image generation failed — ${(e as Error).message}`;
  }
}

// ─── Tool registry ───────────────────────────────────────────────────────────

export const TOOL_DEFS: LlmToolDef[] = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: `Execute a shell command on the machine (${SHELL_NAME}, non-interactive). Returns exit code, stdout and stderr. Use this to control the computer: run/manage programs, install packages, git, network tools, calculations, process management, anything the terminal can do. Avoid commands that wait for stdin. Timeout up to 60s.`,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The bash command to execute" },
          timeout_seconds: {
            type: "integer",
            description: "Max seconds to wait (1-60, default 30)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: `List the contents of a directory (names, types, sizes, modified dates). Default path is the project directory ${WORKSPACE}. Dangers: none. Use before reading files to explore structure.`,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: `Absolute directory path (default ${WORKSPACE})`,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a text file with numbered lines. Supports paging with start_line/max_lines for large files. Binary files are detected and reported.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path" },
          start_line: { type: "integer", description: "1-based first line (default 1)" },
          max_lines: { type: "integer", description: "Lines to read (default 300, max 1000)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: `Create or overwrite a file with the given content. Parent directories are created automatically. Writes are restricted to the project folder (${WORKSPACE}) and the user's home folder (${HOME_ROOT}) for safety.`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: `Absolute file path under ${WORKSPACE} or ${HOME_ROOT}` },
          content: { type: "string", description: "Full file content to write" },
          create_directories: { type: "boolean", description: "Create parent dirs (default true)" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web for current information (news, prices, docs, facts, anything recent). Always prefer this over memory for time-sensitive questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          max_results: { type: "integer", description: "Number of results 1-10 (default 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_web_page",
      description:
        "Fetch a web page by URL and extract its readable text content. Use after web_search for details, or for any URL the user provides.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full http(s) URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "system_info",
      description:
        "Get live system telemetry: CPU usage, memory, disk, uptime, load average, process count, IP. No arguments.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate a high-quality image from a text description using an AI image model. Returns a URL that is embedded in your reply as markdown so the user sees the image. Use for any visual request: illustrations, logos, concept art, diagrams-as-art, photos, wallpapers. Craft the prompt with subject + style + lighting + details for best results. You can generate multiple images if asked.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Rich visual description: subject, style, lighting, composition, quality terms (e.g. 'futuristic city skyline at dusk, cyberpunk style, neon reflections, highly detailed')",
          },
          size: {
            type: "string",
            description:
              "Image dimensions: 1024x1024 (square, default), 1344x768 (landscape), 768x1344 (portrait), 1440x720 (wide), 720x1440 (tall), 1152x864, 864x1152",
          },
        },
        required: ["prompt"],
      },
    },
  },
];

const EXECUTORS: Record<
  string,
  (
    args: Record<string, unknown>,
    onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void
  ) => Promise<string>
> = {
  run_command: (a) => runCommand(a as { command?: string; timeout_seconds?: number }),
  list_files: (a) => listFiles(a as { path?: string }),
  read_file: (a) =>
    readAFile(a as { path?: string; start_line?: number; max_lines?: number }),
  write_file: (a) =>
    writeAFile(a as { path?: string; content?: string; create_directories?: boolean }),
  web_search: (a) => webSearch(a as { query?: string; max_results?: number }),
  read_web_page: (a) => readWebPage(a as { url?: string }),
  system_info: () => systemInfo(),
  generate_image: (a, onRetry) =>
    generateImage({ ...(a as { prompt?: string; size?: string }), onRetry }),
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  onRetry?: (info: { attempt: number; total: number; waitMs: number }) => void
): Promise<string> {
  const fn = EXECUTORS[name];
  if (!fn) return `ERROR: unknown tool "${name}"`;
  try {
    return await fn(args, onRetry);
  } catch (e) {
    return `ERROR: tool "${name}" failed — ${(e as Error).message}`;
  }
}
