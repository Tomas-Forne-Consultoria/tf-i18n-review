// Bundles the extension into dist/ (load it in chrome://extensions →
// "Load unpacked"). `--watch` rebuilds on change.
import { build, context } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    content: join(root, "src/content.ts"),
    panel: join(root, "src/panel/main.tsx"),
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: !watch,
  logLevel: "info",
};

await mkdir(outdir, { recursive: true });
await cp(join(root, "static"), outdir, { recursive: true });
if (watch) await (await context(options)).watch();
else await build(options);
