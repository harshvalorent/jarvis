import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const serverPath = path.join(projectRoot, ".next", "standalone", "server.js");

if (!fs.existsSync(serverPath)) {
  console.error(
    "Standalone server not found — run the build first (bun run build / npm run build)."
  );
  process.exit(1);
}

process.env.NODE_ENV = "production";
process.env.JARVIS_PROJECT_ROOT = projectRoot;

const envFile = path.join(projectRoot, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const port = process.env.PORT || "3000";
console.log(`JARVIS production server → http://localhost:${port}`);
spawn(process.execPath, [serverPath], { stdio: "inherit", env: process.env });
