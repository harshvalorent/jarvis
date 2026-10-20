import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { presetById } from "@/lib/ai-providers";
import { VISION_TEST_IMAGE_DATA_URI } from "@/lib/vision-test-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CapabilityReport {
  model: string;
  provider: string;
  text: { ok: boolean; ms: number; error?: string };
  tools: { ok: boolean };
  image: { ok: boolean; error?: string };
  pcControl: { level: "full" | "web-only" | "chat-only"; detail: string };
  /** Modalities the provider's model catalog claims for this model (video/audio can't be probed via chat API). */
  reportedModalities?: string[];
  probedAt: string;
}

function cacheKey(provider: string, model: string): string {
  return `aicap:${provider}:${model}`;
}

async function resolveEndpoint(body: {
  model?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}) {
  let base = body.baseUrl?.trim().replace(/\/+$/, "") ?? "";
  let key = body.apiKey?.trim() ?? "";
  let provider = body.provider?.trim() ?? "";
  if (!base) {
    const s = await getSettings();
    if (s.aiProvider !== "zai" && s.aiBaseUrl) {
      base = s.aiBaseUrl;
      key = key || s.aiApiKey;
      provider = provider || s.aiProvider;
    }
  }
  if (!base && provider && presetById(provider)) base = presetById(provider)!.baseUrl;
  return { base, key, provider: provider || "saved" };
}

async function probe(
  base: string,
  key: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<{ res?: Response; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { res, ms: Date.now() - started };
  } catch (e) {
    return { ms: Date.now() - started, error: (e as Error).message.slice(0, 160) };
  }
}

export async function GET(req: NextRequest) {
  const model = req.nextUrl.searchParams.get("model")?.trim() ?? "";
  const provider = req.nextUrl.searchParams.get("provider")?.trim() ?? "saved";
  if (!model) return Response.json({ error: "Missing model" }, { status: 400 });
  try {
    const row = await db.setting.findUnique({ where: { key: cacheKey(provider, model) } });
    if (row) return Response.json({ cached: true, ...(JSON.parse(row.value) as CapabilityReport) });
  } catch {
    // cache miss
  }
  return Response.json({ cached: false });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    model?: string;
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
  } | null;
  const model = body?.model?.trim();
  if (!model) return Response.json({ error: "Missing model" }, { status: 400 });

  const { base, key, provider } = await resolveEndpoint(body ?? {});
  if (!base) {
    return Response.json(
      { error: "No provider configured — select a provider, save it, then run the check." },
      { status: 400 }
    );
  }

  const report: CapabilityReport = {
    model,
    provider,
    text: { ok: false, ms: 0 },
    tools: { ok: false },
    image: { ok: false },
    pcControl: { level: "chat-only", detail: "No tool calling — model can chat and search the web only." },
    probedAt: new Date().toISOString(),
  };

  try {
    const mres = await fetch(`${base}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    if (mres.ok) {
      const mjson = (await mres.json()) as
        | { data?: { id?: string; architecture?: { input_modalities?: string[] } }[] }
        | { id?: string; architecture?: { input_modalities?: string[] } }[];
      const list = Array.isArray(mjson) ? mjson : (mjson.data ?? []);
      const meta = list.find((m) => m.id === model);
      if (meta?.architecture?.input_modalities?.length) {
        report.reportedModalities = meta.architecture.input_modalities;
      }
    }
  } catch {
    // metadata is optional — probes below are the primary evidence
  }

  const timeTool = {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Returns the current local time",
      parameters: { type: "object", properties: {}, required: [] },
    },
  };

  const textProbe = await probe(
    base,
    key,
    { model, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 300 },
    30000
  );
  report.text.ms = textProbe.ms;
  if (textProbe.res) {
    if (textProbe.res.ok) report.text.ok = true;
    else report.text.error = `HTTP ${textProbe.res.status}: ${(await textProbe.res.text()).slice(0, 180)}`;
  } else {
    report.text.error = textProbe.error;
  }

  if (report.text.ok) {
    const toolProbe = await probe(
      base,
      key,
      {
        model,
        messages: [{ role: "user", content: "What is the current time? You must call the provided tool." }],
        tools: [timeTool],
        tool_choice: "auto",
        max_tokens: 1000,
      },
      30000
    );
    if (toolProbe.res?.ok) {
      try {
        const json = (await toolProbe.res.json()) as {
          choices?: { message?: { tool_calls?: unknown[] }; finish_reason?: string }[];
        };
        report.tools.ok = Boolean(json.choices?.[0]?.message?.tool_calls?.length) || json.choices?.[0]?.finish_reason === "tool_calls";
      } catch {
        report.tools.ok = false;
      }
    }
  }

  const imageProbe = await probe(
    base,
    key,
    {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image in one word." },
            { type: "image_url", image_url: { url: VISION_TEST_IMAGE_DATA_URI } },
          ],
        },
      ],
      max_tokens: 300,
    },
    30000
  );
  if (imageProbe.res) {
    if (imageProbe.res.ok) report.image.ok = true;
    else {
      const errText = (await imageProbe.res.text()).slice(0, 160);
      report.image.error = `HTTP ${imageProbe.res.status}: ${errText}`;
    }
  } else {
    report.image.error = imageProbe.error;
  }

  const s = await getSettings();
  if (report.tools.ok) {
    const canDrivePc = s.toolPermissions.runCommand || s.toolPermissions.fileAccess;
    report.pcControl = canDrivePc
      ? { level: "full", detail: "Tool calling works — the model can fully drive this PC via JARVIS (terminal, files, apps) with current tool permissions." }
      : { level: "web-only", detail: "Tool calling works, but command/file tools are disabled in Tool Permissions — the model is limited to web search and page reading." };
  }

  try {
    await db.setting.upsert({
      where: { key: cacheKey(provider, model) },
      update: { value: JSON.stringify(report) },
      create: { key: cacheKey(provider, model), value: JSON.stringify(report) },
    });
  } catch {
    // cache write is best-effort
  }

  return Response.json(report);
}
