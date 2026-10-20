import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await db.session.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return Response.json(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      messageCount: s._count.messages,
      preview: s.messages[0]?.content?.slice(0, 120) ?? null,
    }))
  );
}

/** Clear all sessions (used by Settings → Data). */
export async function DELETE() {
  await db.session.deleteMany({});
  return Response.json({ ok: true });
}
