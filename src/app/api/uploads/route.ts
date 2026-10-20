import fs from "node:fs/promises";
import path from "node:path";
import { USER_UPLOADS_DIR } from "@/lib/tools";
import {
  AUDIO_EXT_TO_MIME,
  DOC_EXT_TO_MIME,
} from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Full MIME map for everything a user can upload (images + docs + audio). */
const MIME_BY_EXT: Record<string, string> = {
  ...IMAGE_MIME_BY_EXT,
  ...DOC_EXT_TO_MIME,
  ...AUDIO_EXT_TO_MIME,
};

/**
 * Serves user-uploaded files (images, documents, audio) from user-uploads/.
 * GET /api/uploads?id=<uploadId> — id is validated to prevent path traversal.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return new Response("Bad request", { status: 400 });
  }

  const dir = path.resolve(USER_UPLOADS_DIR);
  let found: { file: string; mime: string } | null = null;
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    const candidate = path.resolve(path.join(USER_UPLOADS_DIR, `${id}.${ext}`));
    // Defense in depth: resolved path must stay inside the uploads directory
    if (candidate.startsWith(dir)) {
      try {
        await fs.access(candidate);
        found = { file: candidate, mime };
        break;
      } catch {
        // try next extension
      }
    }
  }

  if (!found) {
    return new Response("Not found", { status: 404 });
  }

  const data = await fs.readFile(found.file);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": found.mime,
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
