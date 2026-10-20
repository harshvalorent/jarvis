import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const dist = path.join(projectRoot, ".next");
const standalone = path.join(dist, "standalone");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("postbuild: .next/standalone/server.js not found — did `next build` succeed?");
  process.exit(1);
}

fs.cpSync(path.join(dist, "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
if (fs.existsSync(path.join(projectRoot, "public"))) {
  fs.cpSync(path.join(projectRoot, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
}
console.log("postbuild: static + public copied into the standalone bundle");
