// Write every ```typescript block in README.md to .docs-samples/, so that
// `tsc -p tsconfig.samples.json` type-checks them against the SDK source.
//
// A sample that uses a method or type the SDK no longer exports then fails to
// compile: prose can be wrong quietly, code cannot. No dependencies, so it
// runs anywhere Node does.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".docs-samples");
const readme = readFileSync(join(root, "README.md"), "utf8");

const samples = [...readme.matchAll(/^```(?:typescript|ts)\s*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
if (samples.length === 0) {
  console.error("README.md has no TypeScript samples to check");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
samples.forEach((code, i) => {
  // `export {}` makes each file a module, so samples cannot see each other's
  // top-level names.
  writeFileSync(join(out, `sample-${String(i + 1).padStart(2, "0")}.ts`), `${code}\nexport {};\n`);
});
console.log(`Extracted ${samples.length} samples to .docs-samples/`);
