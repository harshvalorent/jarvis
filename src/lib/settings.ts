import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, type JarvisSettings } from "@/lib/types";

const CACHE_TTL_MS = 3000;
let cache: { at: number; data: JarvisSettings } | null = null;

export async function getSettings(force = false): Promise<JarvisSettings> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const data: JarvisSettings = { ...DEFAULT_SETTINGS };
  try {
    const rows = await db.setting.findMany();
    for (const row of rows) {
      if (row.key in data) {
        try {
          (data as unknown as Record<string, unknown>)[row.key] = JSON.parse(
            row.value
          );
        } catch {
          // ignore malformed rows
        }
      }
    }
  } catch {
    // DB hiccup → defaults
  }
  cache = { at: Date.now(), data };
  return data;
}

export async function saveSettings(patch: Partial<JarvisSettings>) {
  const entries = Object.entries(patch).filter(([k]) => k in DEFAULT_SETTINGS);
  await Promise.all(
    entries.map(([key, value]) =>
      db.setting.upsert({
        where: { key },
        update: { value: JSON.stringify(value ?? null) },
        create: { key, value: JSON.stringify(value ?? null) },
      })
    )
  );
  cache = null;
}
