import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { AssistantMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const session = await db.session.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  let count = 0;
  const messages = session.messages.map((m) => {
    count++;
    let meta: AssistantMeta | null = null;
    try {
      meta = m.meta ? (JSON.parse(m.meta) as AssistantMeta) : null;
    } catch {
      meta = null;
    }
    return {
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      meta,
      createdAt: m.createdAt.toISOString(),
    };
  });
  return Response.json({
    id: session.id,
    title: session.title,
    messageCount: count,
    messages,
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    await db.session.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
}

/** Rename a session. */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { title?: string } | null;
  const title = (body?.title ?? "").trim().slice(0, 80);
  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  try {
    const session = await db.session.update({
      where: { id },
      data: { title },
    });
    return Response.json({ ok: true, id: session.id, title: session.title });
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
}
