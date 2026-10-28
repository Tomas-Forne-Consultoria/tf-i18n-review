/**
 * End-to-end check of the built extension in Chromium. Serves a fixture app
 * from test/fixtures/locales (one page with key markers, one without), loads
 * dist/ unpacked, opens the panel as a page pinned to the app tab, and stands
 * in for Chrome's folder picker with a real OPFS folder seeded with the
 * fixture files. Screenshots land in test-results/.
 *
 *   pnpm test:e2e
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { encodeKey, stripMarkers } from "../src/protocol.ts";

const root = join(import.meta.dirname, "..");
const LOCALES = ["ca", "es", "en"];
const seed = Object.fromEntries(
  LOCALES.map((l) => [l, readFileSync(join(root, "test/fixtures/locales", `${l}.json`), "utf8")]),
);
const ca = JSON.parse(seed.ca!) as Record<string, Record<string, unknown>>;
const out = join(root, "test-results");
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------ fixture app

function get(path: string): string {
  let node: unknown = ca;
  for (const p of path.split(".")) node = (node as Record<string, unknown>)[p];
  return node as string;
}

function page(marked: boolean): string {
  const t = (key: string, shown = get(key)) => shown + (marked ? encodeKey(key) : "");
  return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><title>Fixture</title>
<style>body{font:16px system-ui;margin:32px;max-width:720px} nav a,footer a{margin-right:16px}</style></head><body>
<nav><a href="#">${t("Nav.home")}</a><a href="#">${t("Nav.pricing")}</a><a href="#">${t("Nav.login")}</a></nav>
<h1>${t("Hero.title")}</h1>
<p>${t("Hero.subtitle")}</p>
<input placeholder="${t("Hero.search")}" size="40"> <button>${t("Hero.cta")}</button>
<p>${t("Results.count", "3 resultats")}</p>
<p>Llegeix les <b>condicions</b> abans de començar.${marked ? encodeKey("Results.rich") : ""}</p>
<dl><dt>${t("Faq.items.0.q")}</dt><dd>${t("Faq.items.0.a")}</dd></dl>
<footer><a href="#">${t("Footer.pricing")}</a><a href="#">${t("Footer.contact")}</a><a href="#">${t("Footer.start")}</a></footer>
</body></html>`;
}

const serve = (port: number, marked: boolean) =>
  new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(marked));
    });
    s.listen(port, "127.0.0.1", () => resolve(s));
  });

const MARKED = 4317;
const PLAIN = 4318;
const servers = [await serve(MARKED, true), await serve(PLAIN, false)];

// ------------------------------------------------------------ browser

const ext = join(root, "dist");
const profile = join(tmpdir(), "i18n-review-e2e-profile");
rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1000, height: 760 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.addInitScript((files: Record<string, string>) => {
  if (location.protocol !== "chrome-extension:") return;
  window.showDirectoryPicker = async () => {
    const opfs = await navigator.storage.getDirectory();
    const dir = await opfs.getDirectoryHandle("locales", { create: true });
    for (const [l, text] of Object.entries(files)) {
      const h = await dir.getFileHandle(`${l}.json`, { create: true });
      if ((await h.getFile()).size) continue;
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    }
    return dir;
  };
}, seed);

const errors: string[] = [];
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const extId = new URL(worker.url()).host;

const app = await ctx.newPage();
app.on("pageerror", (e) => errors.push(`app: ${e.message}`));
await app.goto(`http://localhost:${MARKED}/`);
const tabId = await worker.evaluate(
  async (port: number) => (await chrome.tabs.query({ url: `http://localhost:${port}/*` }))[0]!.id,
  MARKED,
);

const panel = await ctx.newPage();
panel.on("pageerror", (e) => errors.push(`panel: ${e.message}`));
panel.on("console", (m) => {
  if (m.type() === "error") errors.push(`panel console: ${m.text()}`);
});
await panel.setViewportSize({ width: 420, height: 900 });
await panel.goto(`chrome-extension://${extId}/panel.html?tab=${tabId}`);
const row = (key: string) => panel.locator(`[data-key="${key}"]`);
const rows = panel.locator("[data-key]");
const step = (name: string) => console.log(`✓ ${name}`);

// 1. Pick the folder; every marked string is listed in reading order.
await panel.getByRole("button", { name: "Choose translations folder" }).click();
await rows.first().waitFor();
await panel.waitForTimeout(500);
assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key)), [
  "Nav.home",
  "Nav.pricing",
  "Nav.login",
  "Hero.title",
  "Hero.subtitle",
  "Hero.search",
  "Hero.cta",
  "Results.count",
  "Results.rich",
  "Faq.items.0.q",
  "Faq.items.0.a",
  "Footer.pricing",
  "Footer.contact",
  "Footer.start",
]);
step("markers: 14 strings in reading order, attribute and rich text included");

// 2. Hovering a row highlights the element on the page.
await row("Hero.title").hover();
await panel.waitForTimeout(400);
await app.screenshot({ path: join(out, "page-highlight.png") });
step("hover highlight (page-highlight.png)");

// 3. An edit shows on the page live.
await row("Nav.pricing").locator("textarea").first().fill("Preus i plans");
await panel.waitForTimeout(600);
assert.ok(stripMarkers(await app.locator("nav").innerText()).includes("Preus i plans"));
step("live preview of an edit");

// 4. Issues: the English plural uses {n} where Catalan uses {count}.
await panel.locator("header select").nth(1).selectOption("issues");
assert.ok(await row("Results.count").count());
assert.equal(await row("Hero.title").count(), 0);
await panel.locator("header select").nth(1).selectOption("all");
step("issues filter flags the placeholder mismatch");

// 5. Done folds a row; changing its text afterwards reopens it as changed.
for (const k of ["Nav.home", "Nav.login", "Hero.cta"]) await row(k).getByRole("checkbox").check();
assert.equal(await row("Nav.home").locator("textarea").count(), 0);
await row("Hero.cta").getByRole("button", { name: "Expand" }).click();
await row("Hero.cta").locator("textarea").nth(2).fill("Empieza gratis hoy"); // es (base ca first, then en, es)
await panel.waitForTimeout(300);
assert.match(await row("Hero.cta").locator("label").first().innerText(), /Changed/);
assert.match(await row("Hero.cta").locator(".was").innerText(), /Empieza gratis/);
await panel.screenshot({ path: join(out, "panel.png") });
step("done folds; a later change reopens it with the old text (panel.png)");

// 6. Save writes only the edited lines.
await panel.getByRole("button", { name: "Save to files" }).click();
await panel.waitForTimeout(1000);
const written = await panel.evaluate(async (locales: string[]) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("locales");
  const files: Record<string, string> = {};
  for (const l of locales)
    files[l] = await (await (await dir.getFileHandle(`${l}.json`)).getFile()).text();
  return files;
}, LOCALES);
const changedLines = (l: string) => {
  const a = seed[l]!.split("\n");
  const b = written[l]!.split("\n");
  assert.equal(a.length, b.length, `${l}.json line count`);
  return a.flatMap((line, i) => (line === b[i] ? [] : [b[i]!.trim()]));
};
assert.deepEqual(changedLines("ca"), ['"pricing": "Preus i plans",']);
assert.deepEqual(changedLines("es"), ['"cta": "Empieza gratis hoy",']);
assert.deepEqual(changedLines("en"), []);
assert.match(await panel.locator("text=/unsaved/").innerText(), /^0 unsaved/);
step("save rewrites exactly the edited lines");

// 7. Marks survive a panel reload.
await panel.reload();
await rows.first().waitFor();
const progress = (await panel.locator(".progress-row").innerText()).replace(/\s+/g, " ");
assert.match(progress, /2 done/);
assert.match(progress, /1 changed/);
step("marks and the changed state survive a reload");

// 8. An app without markers: matched by text; same folder → same marks.
await app.goto(`http://localhost:${PLAIN}/`);
await panel.getByRole("button", { name: new RegExp(`from localhost:${MARKED}`) }).click();
await panel.locator(".badge.warn").waitFor();
await panel.waitForTimeout(500);
const textKeys = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key));
assert.ok(!textKeys.includes("Results.count") && !textKeys.includes("Results.rich"));
assert.ok(textKeys.includes("Hero.search"), "placeholder matched by text");
assert.match(await row("Hero.cta").innerText(), /Same text as Footer\.start/);
assert.match(await row("Nav.home").locator("label").first().innerText(), /Done/);
await panel.screenshot({ path: join(out, "panel-text-mode.png") });
step("no markers: matched by text, shared texts flagged, marks shared per folder");

assert.deepEqual(errors, []);
step("no page or panel errors");

await ctx.close();
for (const s of servers) s.close();
