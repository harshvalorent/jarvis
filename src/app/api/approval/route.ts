import { NextRequest } from "next/server";
import { resolveApproval } from "@/lib/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    approved?: boolean;
  } | null;
  const id = body?.id;
  if (typeof id !== "string" || typeof body?.approved !== "boolean") {
    return Response.json({ error: "id and approved are required" }, { status: 400 });
  }
  const ok = resolveApproval(id, body.approved);
  return Response.json({ ok });
}
