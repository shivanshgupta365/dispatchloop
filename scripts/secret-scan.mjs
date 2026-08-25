import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "target", ".vercel"]);
const patterns = [
  /BOLNA_API_KEY\\s*=\\s*[^\\s#]+/,
  /SUPABASE_SERVICE_ROLE_KEY\\s*=\\s*[^\\s#]+/,
  /sk_(?:live|test)_[A-Za-z0-9_-]{16,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/
];
const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (stat.size < 1_000_000 && !name.endsWith(".lock")) {
      const text = readFileSync(file, "utf8");
      if (patterns.some((pattern) => pattern.test(text))) findings.push(relative(root, file));
    }
  }
}

walk(root);
if (findings.length) {
  console.error(`Potential secrets found in: ${findings.join(", ")}`);
  process.exit(1);
}
console.log("Secret scan passed.");
