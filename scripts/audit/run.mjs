#!/usr/bin/env node
// HTTP audit harness for the RelKit logistics app. Runs under node (>=22) and bun; no dependencies.
//
//   node run.mjs --base-url http://127.0.0.1:4120 --out <dir> --env <label> [--project <app worktree>] [--only <group>[,<group>]]
//
// Groups (in run order): auth, actors, matrix, lifecycle, validation, http, effects, system, contract
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Audit } from "./lib.mjs";
import { makeFixtures } from "./fixtures.mjs";
import { authGroup, actorsGroup } from "./groups-auth.mjs";
import { matrixGroup } from "./groups-matrix.mjs";
import { lifecycleGroup } from "./groups-lifecycle.mjs";
import { validationGroup } from "./groups-validation.mjs";
import { httpGroup } from "./groups-http.mjs";
import { effectsGroup } from "./groups-effects.mjs";
import { systemGroup } from "./groups-system.mjs";
import { contractGroup } from "./groups-contract.mjs";

const ORDER = ["auth", "actors", "matrix", "lifecycle", "validation", "http", "effects", "system", "contract"];
const NEEDS_ACTORS = new Set(["matrix", "lifecycle", "validation", "http", "effects", "system", "contract"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args["base-url"] || !args.out || !args.env) {
  console.error("usage: run.mjs --base-url <url> --out <dir> --env <label> [--project <dir>] [--only g1,g2] [--run-id <id>]");
  process.exit(2);
}
const runId = (args["run-id"] ?? (Date.now().toString(36).slice(-5) + randomBytes(2).toString("hex").slice(0, 3))).toLowerCase();
const only = args.only ? String(args.only).split(",") : undefined;
const groups = ORDER.filter((g) => !only || only.includes(g) || (g === "actors" && only.some((o) => NEEDS_ACTORS.has(o))));

const outDir = resolve(args.out);
mkdirSync(join(outDir, "commands"), { recursive: true });
const audit = new Audit({ baseUrl: args["base-url"], outDir, env: args.env, project: args.project ? resolve(args.project) : undefined, runId });
const ctx = {};
const fx = makeFixtures(audit, ctx);

const runners = {
  auth: () => authGroup(audit, ctx, fx),
  actors: () => actorsGroup(audit, ctx, fx),
  matrix: () => matrixGroup(audit, ctx, fx),
  lifecycle: () => lifecycleGroup(audit, ctx, fx),
  validation: () => validationGroup(audit, ctx, fx),
  http: () => httpGroup(audit, ctx, fx),
  effects: () => effectsGroup(audit, ctx, fx),
  system: () => systemGroup(audit, ctx, fx),
  contract: () => contractGroup(audit, ctx, fx),
};

console.log(`[audit] env=${args.env} base=${audit.baseUrl} runId=${runId} runtime=${typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`}`);
const started = Date.now();
for (const g of groups) {
  const t = Date.now();
  await audit.group(g, runners[g]);
  const stat = audit.byGroup[g] ?? { total: 0, passed: 0, failed: 0 };
  console.log(`[audit] ${g.padEnd(10)} total=${String(stat.total).padStart(4)} passed=${String(stat.passed).padStart(4)} failed=${String(stat.failed).padStart(4)}  ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

// latency statistics per group, written into the summary
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const latency = {};
for (const row of audit.rows) {
  const ms = row.actual?.durationMs;
  if (typeof ms !== "number" || !row.method || row.method === "-") continue;
  (latency[row.group] ??= []).push({ ms, id: row.id });
}
const latencySummary = {};
const slow = [];
for (const [g, list] of Object.entries(latency)) {
  const sorted = list.map((x) => x.ms).sort((a, b) => a - b);
  latencySummary[g] = { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] };
  for (const x of list) if (x.ms > 1000) slow.push(x);
}
audit.currentGroup = undefined;
audit.flushSummary(false);
const summary = JSON.parse(readFileSync(audit.summaryPath, "utf8"));
summary.latencyMs = latencySummary;
summary.over1s = slow;
summary.finishedAt = new Date().toISOString();
summary.durationSeconds = Math.round((Date.now() - started) / 1000);
summary.runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
writeFileSync(audit.summaryPath, JSON.stringify(summary, null, 2));
console.log(`[audit] done total=${audit.total} passed=${audit.passed} failed=${audit.failed} in ${summary.durationSeconds}s -> ${outDir}`);
process.exit(0);
