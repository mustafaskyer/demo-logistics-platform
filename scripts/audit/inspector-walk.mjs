#!/usr/bin/env node
// Walks every RelKit Inspector page and records evidence for before/after comparison.
// Needs Playwright: install `playwright` beside this script, or set AUDIT_PLAYWRIGHT to the path of its entry module.
// Usage:
//   node inspector-walk.mjs --base http://127.0.0.1:3210 --out <dir> [--theme dark|light] [--width 1440] [--only name1,name2]
//      [--ids <json file with {ok2xx,s401,s422,s409,s500,confirm,betterauth} request ids>]
// Per page writes <name>.png (full page), <name>.txt (visible text), <name>.json (console errors/warnings,
// failed or non-2xx network requests, timeToContentMs, finalUrl). Also writes index.json.
const { chromium } = await import(process.env.AUDIT_PLAYWRIGHT ?? "playwright");
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const base = (args.base ?? "http://127.0.0.1:3210").replace(/\/$/, "");
const out = args.out ?? "./inspector-walk-out";
const theme = args.theme ?? "dark";
const width = Number(args.width ?? 1440);
const only = args.only ? new Set(args.only.split(",")) : null;
mkdirSync(out, { recursive: true });

const api = `${base}/_relkit/backend/_relkit/v1`;
async function getJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Resolve representative request ids from the Inspector API (stable criteria) unless --ids is given.
async function resolveRequestIds() {
  if (args.ids && existsSync(args.ids)) return JSON.parse(readFileSync(args.ids, "utf8"));
  const items = [];
  let cursor;
  for (let page = 0; page < 40; page++) {
    const d = await getJson(`${api}/requests?limit=100&order=desc${cursor ? `&cursor=${cursor}` : ""}`);
    if (!d?.items?.length) break;
    items.push(...d.items);
    cursor = d.nextCursor;
    if (!cursor) break;
  }
  const pick = (f) => items.find(f)?.requestId;
  return {
    ok2xx: pick((i) => i.status === 201 && i.rawPath === "/vehicles"),
    s401: pick((i) => i.status === 401),
    s422: pick((i) => i.status === 422 && i.method === "POST" && i.rawPath === "/drivers"),
    s409: pick((i) => i.status === 409 && i.rawPath === "/vehicles"),
    s500: pick((i) => i.status === 500 && i.rawPath === "/vehicle-models"),
    confirm: pick((i) => i.status === 200 && /\/documents\/[^/]+\/confirm$/.test(i.rawPath)),
    betterauth: pick((i) => i.rawPath.startsWith("/api/auth/sign-in")),
    traceOf500: items.find((i) => i.status === 500 && i.rawPath === "/vehicle-models")?.traceId,
  };
}

const staticPages = [
  ["overview", "/"],
  ["routes", "/routes"],
  ["requests", "/requests"],
  ["traces", "/traces"],
  ["logs", "/logs"],
  ["errors", "/errors"],
  ["graph", "/graph"],
  ["graphs", "/graphs"],
  ["functions", "/functions"],
  ["events", "/events"],
  ["channels", "/channels"],
  ["buckets", "/buckets"],
  ["providers", "/providers"],
  ["domains", "/domains"],
  ["middlewares", "/middlewares"],
  ["env", "/env"],
  ["diagnostics", "/diagnostics"],
  ["api-reference", "/api-reference"],
  ["jobs", "/jobs"],
  ["jobs-runs", "/jobs/runs"],
  ["jobs-schedules", "/jobs/schedules"],
  ["jobs-services", "/jobs/services"],
  ["cache", "/cache"],
  ["agents", "/agents"],
  ["tools", "/tools"],
  ["mcp", "/mcp"],
  ["not-found", "/does-not-exist"],
];
// list page -> detail prefix to follow from its first row link
const followFirst = [
  ["routes", "/routes", "/routes/"],
  ["traces", "/traces", "/traces/"],
  ["errors", "/errors", "/errors/"],
  ["graphs", "/graphs", "/graphs/"],
  ["functions", "/functions", "/functions/"],
  ["events", "/events", "/events/"],
  ["channels", "/channels", "/channels/"],
  ["buckets", "/buckets", "/buckets/"],
  ["providers", "/providers", "/providers/"],
  ["domains", "/domains", "/domains/"],
  ["middlewares", "/middlewares", "/middlewares/"],
];

// The installed @playwright/test may expect a newer browser build than the cache holds: fall back to the
// newest cached headless shell (override with --chromium <path>).
function findChromium() {
  if (args.chromium) return args.chromium;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {}
  const cache = join(process.env.HOME, "Library/Caches/ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  return undefined;
}
const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
const index = [];

async function visit(name, path) {
  if (only && !only.has(name)) return;
  const page = await context.newPage();
  const consoleMsgs = [];
  const badNet = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 2000) });
  });
  page.on("pageerror", (e) => consoleMsgs.push({ type: "pageerror", text: String(e).slice(0, 2000) }));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "failed";
    if (!/ERR_ABORTED/.test(f) || !/\/stream/.test(r.url())) badNet.push({ url: r.url(), method: r.method(), failure: f });
  });
  page.on("response", async (r) => {
    if (r.status() >= 300 && r.status() !== 304) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 600);
      } catch {}
      badNet.push({ url: r.url(), method: r.request().method(), status: r.status(), body });
    }
  });
  const t0 = Date.now();
  let navError = null;
  try {
    await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) {
    navError = String(e);
  }
  // time to content: main has text and no visible "Loading"/"Connecting" placeholder, or 30 s
  let timeToContentMs = null;
  try {
    await page.waitForFunction(
      () => {
        const m = document.querySelector("main") ?? document.body;
        const t = m.innerText || "";
        return t.trim().length > 40 && !/\b(Loading|Connecting|connecting)\b/.test(t);
      },
      null,
      { timeout: 30000, polling: 200 },
    );
    timeToContentMs = Date.now() - t0;
  } catch {}
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => (document.querySelector("main") ?? document.body).innerText).catch(() => "");
  const headings = await page.$$eval("h1,h2", (els) => els.map((e) => e.textContent.trim()).slice(0, 20)).catch(() => []);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth).catch(() => null);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(out, `${name}.txt`), text);
  const rec = { name, path, finalUrl: page.url(), navError, timeToContentMs, headings, horizontalOverflow: overflowX, console: consoleMsgs, network: badNet };
  writeFileSync(join(out, `${name}.json`), JSON.stringify(rec, null, 2));
  index.push({ name, path, finalUrl: page.url(), timeToContentMs, consoleErrors: consoleMsgs.length, badRequests: badNet.length });
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
  await page.close();
  console.log(`${name.padEnd(28)} ${String(timeToContentMs ?? "timeout").padStart(7)} ms  console=${consoleMsgs.length} bad=${badNet.length}`);
  return links;
}

const ids = await resolveRequestIds();
writeFileSync(join(out, "resolved-ids.json"), JSON.stringify(ids, null, 2));
const linksByList = {};
for (const [name, path] of staticPages) linksByList[name] = await visit(name, path);
for (const [listName, , prefix] of followFirst) {
  let links = linksByList[listName];
  if (!links) links = await visit(listName, prefix.slice(0, -1));
  const first = (links ?? []).find((h) => h.startsWith(prefix) && h.length > prefix.length && !h.startsWith("/jobs/runs"));
  if (first) await visit(`${listName}-detail`, first);
  else index.push({ name: `${listName}-detail`, path: null, note: "no row link found" });
}
for (const [k, id] of Object.entries(ids)) {
  if (!id) continue;
  if (k === "traceOf500") await visit("trace-of-500", `/traces/${id}`);
  else await visit(`request-${k}`, `/requests/${id}`);
}
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2));
await browser.close();
