import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set([".git", "node_modules"]);
const ignoredFiles = new Set(["scripts/security-check.mjs"]);
const maxBytes = 1_000_000;

const patterns = [
  {
    name: "OpenAI-style secret key",
    regex: /sk-[A-Za-z0-9_-]{20,}/,
  },
  {
    name: "Bearer token",
    regex: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i,
  },
  {
    name: "Private key block",
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "Personal Gmail address",
    regex: /[A-Z0-9._%+-]+@gmail\.com/i,
  },
  {
    name: "Google API key",
    regex: /AIza[0-9A-Za-z_-]{35}/,
  },
];

const findings = [];

await scanDir(root);

if (findings.length) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.name}: ${finding.file}`);
  }
  process.exit(1);
}

console.log("Security smoke check passed.");

async function scanDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    const relative = path.relative(root, filePath);

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await scanDir(filePath);
      continue;
    }

    if (!entry.isFile() || ignoredFiles.has(relative)) continue;

    const info = await stat(filePath);
    if (info.size > maxBytes) continue;

    const text = await readFile(filePath, "utf8").catch(() => null);
    if (text === null) continue;

    for (const pattern of patterns) {
      if (pattern.regex.test(text)) {
        findings.push({ name: pattern.name, file: relative });
      }
    }
  }
}
