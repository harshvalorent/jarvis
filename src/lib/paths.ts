import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Central runtime location constants.
 *
 * The app was authored for the Z.ai sandbox (Linux, workspace /home/z/my-project).
 * This module re-points every location to the machine the app is actually
 * running on (e.g. Windows E:\dash-ai) while keeping the sandbox semantics:
 *   - WORKSPACE  : the app's own project folder (file explorer default, cwd for shell tools)
 *   - HOME_ROOT  : the user's home directory (allowed read/write boundary in addition
 *                  to the project folder, mirroring the sandbox's /home/z)
 */

export const IS_WINDOWS = process.platform === "win32";

function findProjectRoot(): string {
  // 1) explicit override (start.mjs sets this for the standalone server)
  const envRoot = process.env.JARVIS_PROJECT_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, "package.json"))) {
    return path.resolve(envRoot);
  }
  // 2) walk up from cwd looking for a package.json + src folder
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "src"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

export const PROJECT_ROOT = findProjectRoot();

/** Default working directory for the assistant's file tools / shells. */
export const WORKSPACE = PROJECT_ROOT;

/** Sandbox analogue of /home/z — the user's home directory. */
export const HOME_ROOT = os.homedir();

/**
 * Single organized root for everything the assistant produces on disk:
 *   data/uploads  — user uploads (images, documents, audio)
 *   data/images   — AI-generated images
 *   data/tmp      — transient fixtures / sandbox /tmp
 *   data/db       — SQLite database (see .env DATABASE_URL)
 *   data/tool-results, data/downloads — legacy sandbox output, folded in
 * The legacy top-level dirs (user-uploads/, generated-images/, tool-results/,
 * download/) are folded in exactly once, idempotently, at module load.
 */
export const DATA_DIR = path.join(WORKSPACE, "data");

/** Transient fixture dir (replaces os.tmpdir + sandbox /tmp). */
export const DATA_TMP_DIR = path.join(DATA_DIR, "tmp");

/** Directory for AI-generated images (now data/images). */
export const GENERATED_IMAGES_DIR = path.join(DATA_DIR, "images");

/** Directory for user uploads (now data/uploads). */
export const USER_UPLOADS_DIR = path.join(DATA_DIR, "uploads");

/**
 * Folds the legacy top-level dirs into data/ exactly once. A fresh target dir
 * takes the rename; nothing is deleted when a target already exists.
 */
function migrateLegacyDirs(): void {
  const moves: Array<[string, string]> = [
    [path.join(WORKSPACE, "user-uploads"), USER_UPLOADS_DIR],
    [path.join(WORKSPACE, "generated-images"), GENERATED_IMAGES_DIR],
    [path.join(WORKSPACE, "tool-results"), path.join(DATA_DIR, "tool-results")],
    [path.join(WORKSPACE, "download"), path.join(DATA_DIR, "downloads")],
  ];
  for (const [from, to] of moves) {
    try {
      if (!fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.mkdirSync(to, { recursive: true });
    } catch {
      // best-effort: the app keeps working on the fresh paths regardless
    }
  }
  try {
    fs.mkdirSync(DATA_TMP_DIR, { recursive: true });
  } catch {
    // tmp dir is optional
  }
}
migrateLegacyDirs();

export const SHELL = IS_WINDOWS ? "powershell.exe" : "/bin/bash";
export const SHELL_NAME = IS_WINDOWS ? "PowerShell" : "bash";

/** Roots the assistant may write to / browse (project folder + user home). */
export const WRITE_ROOTS: string[] = Array.from(
  new Set([WORKSPACE, HOME_ROOT].map((r) => path.resolve(r)))
).filter((r) => r.length > 0);

/** True if `target` is inside one of the allowed roots (or is a root itself). */
export function isInsideRoot(target: string, roots: string[]): boolean {
  const t = path.resolve(target);
  return roots.some((root) => {
    const r = path.resolve(root);
    if (process.platform === "win32") {
      return t.toLowerCase() === r.toLowerCase() || t.toLowerCase().startsWith(r.toLowerCase() + path.sep);
    }
    return t === r || t.startsWith(r + path.sep);
  });
}

const POSIX_ROOT_MAPS: Array<[RegExp, () => string]> = [
  [/^\/home\/z\/my-project(?=\/|$)/i, () => WORKSPACE],
  [/^\/home\/z(?=\/|$)/i, () => HOME_ROOT],
  [/^\/tmp(?=\/|$)/i, () => DATA_TMP_DIR],
];

/**
 * Translate sandbox-style POSIX paths ("/home/z/my-project/downloads/x")
 * into real local paths. Unmapped paths are returned unchanged (they resolve
 * as ordinary Windows/POSIX paths downstream).
 */
export function mapSandboxPath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return trimmed;
  for (const [re, toFn] of POSIX_ROOT_MAPS) {
    const m = re.exec(trimmed);
    if (m) {
      const rest = trimmed.slice(m[0].length).replace(/^\/+/, "");
      return rest ? path.join(toFn(), rest) : toFn();
    }
  }
  return trimmed;
}
