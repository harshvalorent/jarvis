import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { executeTool } from "@/lib/tools";
import { analyzeImages, callCore } from "@/lib/llm";
import { extractDocumentText } from "@/lib/documents";
import { VISION_TEST_IMAGE_DATA_URI } from "@/lib/vision-test-image";

import type { JarvisSettings, ToolPermissions } from "@/lib/types";
import { DEFAULT_TOOL_PERMISSIONS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings(true);
  return Response.json(settings);
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<JarvisSettings> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const patch: Partial<JarvisSettings> = {};
  if (typeof body.speakResponses === "boolean") patch.speakResponses = body.speakResponses;
  if (typeof body.autoSendVoice === "boolean") patch.autoSendVoice = body.autoSendVoice;
  if (typeof body.wakeWord === "boolean") patch.wakeWord = body.wakeWord;
  if (typeof body.voiceRate === "number") patch.voiceRate = Math.min(Math.max(body.voiceRate, 0.5), 2);
  if (typeof body.voicePitch === "number") patch.voicePitch = Math.min(Math.max(body.voicePitch, 0.5), 2);
  if (typeof body.voiceUri === "string") patch.voiceUri = body.voiceUri.slice(0, 200);
  if (typeof body.userName === "string" && body.userName.trim()) {
    patch.userName = body.userName.trim().slice(0, 40);
  }
  if (typeof body.customInstructions === "string") {
    patch.customInstructions = body.customInstructions.slice(0, 2000);
  }
  if (body.responseStyle === "concise" || body.responseStyle === "balanced" || body.responseStyle === "detailed") {
    patch.responseStyle = body.responseStyle;
  }
  if (typeof body.micDeviceId === "string") patch.micDeviceId = body.micDeviceId.slice(0, 200);
  if (typeof body.sttLang === "string" && body.sttLang.trim()) patch.sttLang = body.sttLang.trim().slice(0, 20);
  if (typeof body.coreSystemPrompt === "string") patch.coreSystemPrompt = body.coreSystemPrompt.slice(0, 4000);
  if (
    body.safetyLevel === "strict" ||
    body.safetyLevel === "standard" ||
    body.safetyLevel === "relaxed" ||
    body.safetyLevel === "unrestricted"
  ) {
    patch.safetyLevel = body.safetyLevel;
  }
  if (body.reasoningMode === "fast" || body.reasoningMode === "deep" || body.reasoningMode === "ultra") {
    patch.reasoningMode = body.reasoningMode;
  }
  if (body.webAccessMode === "standard" || body.webAccessMode === "unrestricted") {
    patch.webAccessMode = body.webAccessMode;
  }
  if (body.toolPermissions && typeof body.toolPermissions === "object") {
    const requested = body.toolPermissions as Partial<ToolPermissions>;
    const perms: ToolPermissions = { ...DEFAULT_TOOL_PERMISSIONS };
    for (const key of Object.keys(DEFAULT_TOOL_PERMISSIONS) as (keyof ToolPermissions)[]) {
      if (typeof requested[key] === "boolean") perms[key] = requested[key] as boolean;
    }
    patch.toolPermissions = perms;
  }

  await saveSettings(patch);
  const settings = await getSettings(true);
  return Response.json(settings);
}

/**
 * Core diagnostics — exercises the live AI systems end-to-end:
 *  - core:      a real completion through the reasoning core
 *  - vision:    a real multimodal image analysis (color-band test image)
 *  - documents: real PDF + DOCX extraction through the document reader
 *  - tools:     terminal / telemetry / live web / image generation self-tests
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { action?: string }
    | null;
  if (body?.action !== "test" && body?.action !== "diagnostics") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const full = body.action === "diagnostics";
  const settings = await getSettings(true);

  // ── Reasoning core test ──
  let core: { ok: boolean; ms?: number; detail?: string; error?: string } = { ok: true };
  {
    const t0 = Date.now();
    try {
      const result = await callCore({
        reasoningMode: "fast",
        messages: [{ role: "user", content: "Reply with exactly: CORE ONLINE" }],
        tools: [],
      });
      const ok = /core/i.test(result.content ?? "");
      core = { ok, ms: Date.now() - t0, detail: (result.content ?? "").slice(0, 80) };
    } catch (e) {
      core = { ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 160) };
    }
  }

  // ── Vision (multimodal) test ──
  let vision: { ok: boolean; ms?: number; detail?: string; error?: string } = { ok: true };
  {
    const t0 = Date.now();
    try {
      const report = await analyzeImages({
        dataUris: [VISION_TEST_IMAGE_DATA_URI],
        userText: "What colors and layout does this image have?",
      });
      const ok = /red|green|blue/i.test(report);
      vision = {
        ok,
        ms: Date.now() - t0,
        detail: ok ? "correctly identified the color bands" : report.slice(0, 80),
      };
    } catch (e) {
      vision = { ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 160) };
    }
  }

  // ── Document reader test (pdf via pdftotext + docx via mammoth) ──
  let documents: { ok: boolean; ms?: number; detail?: string; error?: string } = { ok: true };
  {
    const t0 = Date.now();
    const tmpDir = path.join(os.tmpdir(), `jvdiag_${Date.now()}`);
    try {
      await fs.mkdir(tmpDir, { recursive: true });

      // 1) build a real PDF fixture (pure JS, no deps)
      const pdfText = "BT /F1 12 Tf 72 720 Td (JARVIS PDF READ TEST 77) Tj ET";
      const objs = [
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
        `4 0 obj<</Length ${pdfText.length}>>stream\n${pdfText}\nendstream endobj`,
        "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
      ];
      let pdf = "%PDF-1.1\n";
      const offsets = [0];
      for (const o of objs) {
        offsets.push(pdf.length);
        pdf += o + "\n";
      }
      const xref = pdf.length;
      pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= objs.length; i++)
        pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
      pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
      const pdfPath = path.join(tmpDir, "test.pdf");
      await fs.writeFile(pdfPath, pdf, "binary");

      // 2) build a real DOCX fixture (pure JS via jszip — no pandoc dependency)
      const docxPath = path.join(tmpDir, "test.docx");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      );
      zip.folder("_rels")!.file(
        ".rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
      );
      const wordDir = zip.folder("word")!;
      wordDir.file(
        "document.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>JARVIS DOCX READ TEST 88</w:t></w:r></w:p></w:body></w:document>`
      );
      wordDir.folder("_rels")!.file(
        "document.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
      );
      await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

      const pdfOut = await extractDocumentText(await fs.readFile(pdfPath), "pdf");
      const docxOut = await extractDocumentText(await fs.readFile(docxPath), "docx");
      const pdfOk = pdfOut.text.includes("77") || pdfOut.text.toUpperCase().includes("JARVIS");
      const docxOk = docxOut.text.includes("88") || docxOut.text.toUpperCase().includes("JARVIS");
      documents = {
        ok: pdfOk && docxOk,
        ms: Date.now() - t0,
        detail: pdfOk && docxOk
          ? `pdf via ${pdfOut.method}, docx via ${docxOut.method}`
          : `pdf(${pdfOut.method}): ${pdfOut.text.slice(0, 40)} · docx(${docxOut.method}): ${docxOut.text.slice(0, 40)}`,
      };
    } catch (e) {
      documents = { ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 160) };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ── Tool self-tests (full diagnostics only) ──
  const toolResults: Record<
    string,
    { ok: boolean; ms?: number; detail?: string; error?: string }
  > = {};

  if (full) {
    // Terminal
    {
      const t0 = Date.now();
      try {
        const out = await executeTool("run_command", {
          command: "echo JARVIS-CORE-OK",
        });
        toolResults.command = {
          ok: out.includes("JARVIS-CORE-OK") && !out.startsWith("ERROR"),
          ms: Date.now() - t0,
          detail: out.split("\n")[1] ?? out.slice(0, 80),
        };
      } catch (e) {
        toolResults.command = { ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    }
    // System telemetry
    {
      const t0 = Date.now();
      try {
        const out = await executeTool("system_info", {});
        toolResults.system = {
          ok: !out.startsWith("ERROR") && out.includes("CPU"),
          ms: Date.now() - t0,
          detail: out.split("\n")[0].slice(0, 80),
        };
      } catch (e) {
        toolResults.system = { ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    }
    // Live web search
    {
      const t0 = Date.now();
      try {
        const out = await executeTool("web_search", {
          query: "latest AI news today",
          max_results: 3,
        });
        toolResults.web = {
          ok: !out.startsWith("ERROR") && out.includes("results"),
          ms: Date.now() - t0,
          detail: out.split("\n")[0].slice(0, 80),
        };
      } catch (e) {
        toolResults.web = { ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    }
    // Image generation
    {
      const t0 = Date.now();
      try {
        const out = await executeTool("generate_image", {
          prompt: "minimal glowing cyan arc reactor core on dark background, hud style",
          size: "1024x1024",
        });
        toolResults.image = {
          ok: out.startsWith("IMAGE GENERATED"),
          ms: Date.now() - t0,
          detail: out.includes("/api/image?id=") ? "image rendered successfully" : out.slice(0, 80),
        };
      } catch (e) {
        toolResults.image = { ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    }
  }

  return Response.json({
    core,
    vision,
    documents,
    ...(full ? { tools: toolResults } : {}),
    mode: settings.reasoningMode,
  });
}
