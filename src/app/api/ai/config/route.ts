import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { invalidateZaiConfigCache } from "@/lib/llm";
import { PROJECT_ROOT } from "@/lib/paths";
import { AI_PROVIDER_PRESETS, presetById } from "@/lib/ai-providers";
import type { CustomProvider, JarvisSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readConfigFile(): Promise<{ exists: boolean; baseUrl?: string; model?: string }> {
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, ".z-ai-config"), "utf8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    return {
      exists: true,
      baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : undefined,
      model: typeof cfg.model === "string" ? cfg.model : undefined,
    };
  } catch {
    return { exists: false };
  }
}

async function configPayload() {
  const s = await getSettings(true);
  return {
    provider: s.aiProvider,
    baseUrl: s.aiBaseUrl,
    apiKeySet: Boolean(s.aiApiKey),
    model: s.aiModel,
    visionModel: s.aiVisionModel,
    asrModel: s.aiAsrModel,
    customProviders: s.customProviders,
    presets: AI_PROVIDER_PRESETS,
    fileConfig: await readConfigFile(),
  };
}

export async function GET() {
  return Response.json(await configPayload());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    visionModel?: string;
    asrModel?: string;
    customProviders?: CustomProvider[];
  } | null;
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const patch: Partial<JarvisSettings> = {};

  if (Array.isArray(body.customProviders)) {
    const seen = new Set<string>();
    const list: CustomProvider[] = [];
    for (const c of body.customProviders) {
      if (!c || typeof c.name !== "string" || typeof c.baseUrl !== "string") continue;
      const name = c.name.trim().slice(0, 40);
      let url = c.baseUrl.trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      if (!name || !/^https?:\/\/.+/.test(url)) continue;
      const id = typeof c.id === "string" && c.id.startsWith("custom:") ? c.id : `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, name, baseUrl: url });
    }
    patch.customProviders = list;
  }

  if (typeof body.provider === "string") {
    const id = body.provider;
    if (id !== "zai" && !presetById(id) && !id.startsWith("custom:")) {
      return Response.json({ error: `Unknown provider "${id}"` }, { status: 400 });
    }
    patch.aiProvider = id;
    if (id === "zai") {
      patch.aiBaseUrl = "";
    } else if (presetById(id)) {
      patch.aiBaseUrl = presetById(id)!.baseUrl;
    } else {
      const current = await getSettings();
      const customList = patch.customProviders ?? current.customProviders;
      const cp = customList.find((c) => c.id === id);
      if (!cp) return Response.json({ error: "Custom provider not found" }, { status: 400 });
      patch.aiBaseUrl = cp.baseUrl;
    }
  }

  if (typeof body.baseUrl === "string" && patch.aiProvider?.startsWith("custom:")) {
    let url = body.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    patch.aiBaseUrl = url;
  }

  if (typeof body.apiKey === "string") {
    patch.aiApiKey = body.apiKey.trim().slice(0, 400);
  }
  if (typeof body.model === "string") patch.aiModel = body.model.trim().slice(0, 160);
  if (typeof body.visionModel === "string") patch.aiVisionModel = body.visionModel.trim().slice(0, 160);
  if (typeof body.asrModel === "string") patch.aiAsrModel = body.asrModel.trim().slice(0, 160);

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await saveSettings(patch);
  invalidateZaiConfigCache();

  return Response.json(await configPayload());
}
