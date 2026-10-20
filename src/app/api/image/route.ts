import fs from "node:fs/promises";
import path from "node:path";
import { GENERATED_IMAGES_DIR } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves AI-generated images from generated-images/.
 * GET /api/image?id=<imageId> — id is validated to prevent path traversal.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return new Response("Bad request", { status: 400 });
  }

  const filePath = path.join(GENERATED_IMAGES_DIR, `${id}.png`);
  // Defense in depth: resolved path must stay inside the images directory
  if (!path.resolve(filePath).startsWith(path.resolve(GENERATED_IMAGES_DIR))) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(data.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
