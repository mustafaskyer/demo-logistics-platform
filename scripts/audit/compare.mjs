#!/usr/bin/env node
// Compares two results.jsonl files by row id: node compare.mjs <a/results.jsonl> <b/results.jsonl>
// Run ids differ between runs, so only ids (group:name) and pass/fail are compared; actual statuses are listed when they differ.
import { readFileSync } from "node:fs";
const load = (p) => new Map(readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.id, r]));
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const onlyA = [...a.keys()].filter((k) => !b.has(k));
const onlyB = [...b.keys()].filter((k) => !a.has(k));
const passDiff = [...a.keys()].filter((k) => b.has(k) && a.get(k).pass !== b.get(k).pass);
const statusDiff = [...a.keys()].filter((k) => b.has(k) && a.get(k).actual.status !== b.get(k).actual.status);
console.log(JSON.stringify({ rowsA: a.size, rowsB: b.size, onlyInA: onlyA, onlyInB: onlyB, passFailDifferences: passDiff.map((k) => ({ id: k, a: a.get(k).pass, b: b.get(k).pass, statusA: a.get(k).actual.status, statusB: b.get(k).actual.status })), statusDifferencesWithSamePass: statusDiff.filter((k) => !passDiff.includes(k)).map((k) => ({ id: k, a: a.get(k).actual.status, b: b.get(k).actual.status })) }, null, 2));
