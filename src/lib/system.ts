import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { IS_WINDOWS, PROJECT_ROOT } from "@/lib/paths";
import type { SystemStats } from "@/lib/types";

const execAsync = promisify(exec);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cached: { at: number; data: SystemStats } | null = null;
const CACHE_MS = 2000;

function cpuUsagePercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq;
  }
  return total > 0 ? (1 - idle / total) * 100 : 0;
}

async function cpuUsageSampled(): Promise<number> {
  const before = cpuUsagePercent();
  await sleep(220);
  const after = cpuUsagePercent();
  return Math.max(0, Math.min(100, after - before > 0 ? after : before));
}

async function diskStats(): Promise<{ total: number; used: number }> {
  try {
    const target = IS_WINDOWS ? PROJECT_ROOT : "/";
    const st = (await fs.statfs(target)) as { blocks: number; bsize: number; bavail: number };
    const total = st.blocks * st.bsize;
    const avail = st.bavail * st.bsize;
    return { total, used: Math.max(0, total - avail) };
  } catch {
    if (IS_WINDOWS) {
      try {
        const driveRoot = path.parse(PROJECT_ROOT).root;
        const { stdout } = await execAsync(`fsutil volume diskfree ${driveRoot}`, { timeout: 5000 });
        const bytesFromLabel = (label: string): number => {
          const m = stdout.match(new RegExp(`${label}[^\\r\\n]*\\(([0-9,.]+)\\s*bytes`, "i"));
          return m ? Number(m[1].replace(/[.,]/g, "")) : 0;
        };
        const total = bytesFromLabel("Total size");
        const avail = bytesFromLabel("Available");
        if (total > 0 && avail > 0) return { total, used: Math.max(0, total - avail) };
      } catch {
        // ignore
      }
      return { total: 0, used: 0 };
    }
    try {
      const { stdout } = await execAsync("df -B1 /", { timeout: 3000 });
      const line = stdout.split("\n").find((l) => l.startsWith("/") || /%\s*\/\s*$/.test(l));
      if (line) {
        const parts = line.trim().split(/\s+/);
        return { total: Number(parts[1]) || 0, used: Number(parts[2]) || 0 };
      }
    } catch {
      // ignore
    }
    return { total: 0, used: 0 };
  }
}

async function primaryIp(): Promise<string> {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

async function processCount(): Promise<number> {
  if (IS_WINDOWS) {
    try {
      const { stdout } = await execAsync("tasklist /NH /FO CSV", { timeout: 6000 });
      return stdout.split("\n").filter((l) => l.trim().startsWith('"')).length;
    } catch {
      return 0;
    }
  }
  try {
    const entries = await fs.readdir("/proc");
    return entries.filter((e) => /^\d+$/.test(e)).length;
  } catch {
    return 0;
  }
}

export async function getSystemStats(): Promise<SystemStats> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  const [cpuUsage, disk, ip, processes] = await Promise.all([
    cpuUsageSampled(),
    diskStats(),
    primaryIp(),
    processCount(),
  ]);

  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  const cpus = os.cpus();
  const runtime = process.versions.bun
    ? `Bun ${process.versions.bun} / Node-compat ${process.versions.node ?? "?"}`
    : `Node.js ${process.versions.node ?? "?"}`;

  const data: SystemStats = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osVersion: os.release(),
    cpuModel: (cpus[0]?.model ?? "unknown").replace(/\s+/g, " ").trim().slice(0, 48),
    cpuCores: cpus.length,
    cpuUsage: Number.isFinite(cpuUsage) ? Math.round(cpuUsage * 10) / 10 : 0,
    loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    memTotal,
    memUsed,
    memPct: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
    diskTotal: disk.total,
    diskUsed: disk.used,
    diskPct: disk.total > 0 ? (disk.used / disk.total) * 100 : 0,
    uptime: os.uptime(),
    processes,
    ip,
    runtime,
    timestamp: Date.now(),
  };

  cached = { at: Date.now(), data };
  return data;
}
