import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  HOME_ROOT,
  WRITE_ROOTS,
  WORKSPACE,
  isInsideRoot,
  mapSandboxPath,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PATH = WORKSPACE;
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip",
  ".gz", ".tar", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".exe", ".dll",
  ".so", ".dylib", ".bin", ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".ogg", ".webm", ".db",
  ".sqlite", ".class", ".jar", ".wasm", ".node", ".lockb",
]);

async function resolveInsideHome(p: string): Promise<string | null> {
  const resolved = path.resolve(mapSandboxPath(p));
  if (!isInsideRoot(resolved, WRITE_ROOTS)) return null;
  try {
    return await fs.realpath(resolved);
  } catch {
    // path may not exist yet (for writes) — the prefix check already passed
    return resolved;
  }
}

function formatBytes(bytes: number): string {
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path") || DEFAULT_PATH;
  const wantRead = url.searchParams.get("read") === "1";

  const target = await resolveInsideHome(rawPath);
  if (!target) {
    return Response.json(
      { error: `Access denied — path outside the project folder (${WORKSPACE}) and user folder (${HOME_ROOT})` },
      { status: 403 }
    );
  }

  try {
    if (wantRead) {
      const st = await fs.stat(target);
      if (!st.isFile()) {
        return Response.json({ error: "Not a file" }, { status: 400 });
      }
      if (BINARY_EXTENSIONS.has(path.extname(target).toLowerCase())) {
        return Response.json({
          path: target,
          binary: true,
          size: st.size,
          sizeLabel: formatBytes(st.size),
        });
      }
      if (st.size > 200 * 1024) {
        return Response.json({
          path: target,
          content: null,
          truncated: true,
          size: st.size,
          sizeLabel: formatBytes(st.size),
        });
      }
      const content = await fs.readFile(target, "utf8");
      return Response.json({
        path: target,
        content,
        size: st.size,
        sizeLabel: formatBytes(st.size),
        truncated: false,
      });
    }

    const st = await fs.stat(target);
    if (!st.isDirectory()) {
      return Response.json({ error: "Not a directory" }, { status: 400 });
    }
    const entries = await fs.readdir(target, { withFileTypes: true });
    const items = await Promise.all(
      entries.slice(0, 500).map(async (entry) => {
        const full = path.join(target, entry.name);
        let size = 0;
        let mtime = 0;
        try {
          const s = await fs.stat(full);
          size = s.size;
          mtime = s.mtime.getTime();
        } catch {
          // broken symlink
        }
        return {
          name: entry.name,
          path: full,
          isDir: entry.isDirectory(),
          size,
          mtime,
        };
      })
    );
    items.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    return Response.json({
      path: target,
      parent: path.dirname(target),
      entries: items,
      count: items.length,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    path?: string;
    content?: string;
  } | null;
  if (!body?.path || typeof body.content !== "string") {
    return Response.json({ error: "path and content required" }, { status: 400 });
  }
  const target = await resolveInsideHome(body.path);
  if (!target) {
    return Response.json(
      { error: `Writes are restricted to the project folder (${WORKSPACE}) and user folder (${HOME_ROOT})` },
      { status: 403 }
    );
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body.content, "utf8");
    return Response.json({ ok: true, path: target, bytes: body.content.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    action?: "mkdir" | "delete" | "rename";
    path?: string;
    to?: string;
  } | null;
  const action = body?.action;
  const rawPath = body?.path ?? "";

  if (action === "mkdir") {
    const target = await resolveInsideHome(rawPath);
    if (!target) return Response.json({ error: "Restricted to project/user folders" }, { status: 403 });
    try {
      await fs.mkdir(target, { recursive: true });
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "delete") {
    const target = await resolveInsideHome(rawPath);
    if (!target) return Response.json({ error: "Restricted to project/user folders" }, { status: 403 });
    const isProtectedRoot =
      target === HOME_ROOT ||
      target === WORKSPACE ||
      target.toLowerCase() === HOME_ROOT.toLowerCase() ||
      target.toLowerCase() === WORKSPACE.toLowerCase();
    if (isProtectedRoot) {
      return Response.json({ error: "Refusing to delete root/workspace folder" }, { status: 403 });
    }
    try {
      await fs.rm(target, { recursive: true, force: true });
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "rename") {
    const from = await resolveInsideHome(rawPath);
    const to = await resolveInsideHome(body?.to ?? "");
    if (!from || !to) return Response.json({ error: "Restricted to project/user folders" }, { status: 403 });
    try {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
