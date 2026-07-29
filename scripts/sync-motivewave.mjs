// Regenerates src/lib/motivewave-indicator.ts from the compilable Java source.
// The .java file is the source of truth so it can be compiled and tested
// against the real MotiveWave SDK; the generated module is what the app copies
// to the clipboard. tests/calculations.test.mjs fails if the two drift apart.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const JAVA_SOURCE = join(root, "motivewave", "gexlab", "GexLabLevels.java");
export const GENERATED_MODULE = join(root, "src", "lib", "motivewave-indicator.ts");

export function renderModule(java) {
  // String.raw cannot represent an escaped backtick or template placeholder, so
  // refuse rather than emit a module that silently differs from the source.
  if (java.includes("`") || java.includes("${")) {
    throw new Error(
      "GexLabLevels.java contains a backtick or ${ sequence, which cannot be embedded in String.raw.",
    );
  }
  return `// Generated from motivewave/gexlab/GexLabLevels.java by scripts/sync-motivewave.mjs.
// Edit the Java file and run "npm run sync:motivewave" instead of editing this file.
export const MOTIVEWAVE_STUDY = String.raw\`${java}\`;
`;
}

export function readJavaSource() {
  return readFileSync(JAVA_SOURCE, "utf8").replace(/\r\n/g, "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(GENERATED_MODULE, renderModule(readJavaSource()));
  console.log(`Wrote ${GENERATED_MODULE}`);
}
