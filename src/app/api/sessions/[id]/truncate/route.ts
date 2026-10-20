import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Truncate a session's message history.
 * mode "from"  → delete the given message AND everything after it (used by "edit & resubmit"
 *                 and "regenerate": the client then re-sends the text via /api/chat).
 * mode "after" → delete everything after the given message, keeping it (used to prune tails).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    messageId?: string;
    mode?: "from" | "after";
  } | null;

  const messageId = body?.messageId;
  const mode = body?.mode === "after" ? "after" : "from";
  if (typeof messageId !== "string" || !messageId) {
    return Response.json({ error: "messageId is required" }, { status: 400 });
  }

  const session = await db.session.findUnique({ where: { id } });
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const target = await db.message.findFirst({
    where: { sessionId: id, id: messageId },
  });
  if (!target) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  // Delete in correct order regardless of createdAt ties
  if (mode === "from") {
    // Includes the target message itself (createdAt >= target's)
    await db.message.deleteMany({
      where: { sessionId: id, createdAt: { gte: target.createdAt } },
    });
  } else {
    await db.message.deleteMany({
      where: { sessionId: id, createdAt: { gt: target.createdAt } },
    });
  }

  const remaining = await db.message.count({ where: { sessionId: id } });
  return Response.json({ ok: true, remaining });
}
