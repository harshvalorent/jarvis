import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { presetById } from "@/lib/ai-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RawModel {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let base = sp.get("baseUrl")?.trim().replace(/\/+$/, "") ?? "";
  const provider = sp.get("provider")?.trim() ?? "";
  const keyParam = sp.get("key")?.trim() ?? "";

  if (!base) {
    if (provider && presetById(provider)) base = presetById(provider)!.baseUrl;
    else if (provider === "zai") {
      return Response.json({ error: "The native Z.ai engine does not expose a model list — models are chosen server-side." }, { status: 400 });
    } else {
      const s = await getSettings();
      base = s.aiBaseUrl;
    }
  }
  if (!base || !/^https?:\/\//i.test(base)) {
    return Response.json({ error: "No provider base URL configured" }, { status: 400 });
  }

  let apiKey = keyParam;
  if (!apiKey && provider) {
    const s = await getSettings();
    if (!provider || provider === s.aiProvider) apiKey = s.aiApiKey;
  }

  try {
    const res = await fetch(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return Response.json({ error: `Model list request failed (HTTP ${res.status}): ${body}` }, { status: 502 });
    }
    const json = (await res.json()) as { data?: RawModel[] } | RawModel[];
    const rawList = Array.isArray(json) ? json : (json.data ?? []);
    const models = rawList
      .filter((m) => typeof m.id === "string" && m.id)
      .map((m) => {
        const free =
          m.pricing?.prompt === "0" && m.pricing?.completion === "0" ? true : undefined;
        return {
          id: m.id!,
          name: m.name || undefined,
          contextLength: typeof m.context_length === "number" ? m.context_length : undefined,
          inputModalities: m.architecture?.input_modalities,
          outputModalities: m.architecture?.output_modalities,
          free,
        };
      });
    return Response.json({ provider: provider || "saved", baseUrl: base, count: models.length, models });
  } catch (e) {
    return Response.json(
      { error: `Could not reach ${base}/models — ${(e as Error).message.slice(0, 160)}` },
      { status: 502 }
    );
  }
}
