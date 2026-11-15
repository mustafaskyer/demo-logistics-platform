#!/usr/bin/env node
// Subscribes to the fleet.vehicle-status channel as one checklist actor and prints every frame as a
// JSON line. Runs under Node (>= 22) and Bun. Used by docs/api-validation-checklist.md.
//
//   node scripts/checklist/realtime.mjs --state <S> --actor <name> --company <id>
//        [--transport http|ws] [--events <n>] [--timeout <ms>] [--after <checkpoint-json-file>]
//        [--channel <id>] [--params '<json>']
//
// --state    folder written by scripts/checklist/setup-actors.sh (reads <actor>.jar and ids.env)
// --actor    owner | admin | dispatcher | driver | member | ownerB | nocompany | anon
// --events   stop after this many `event` frames (default 1); 0 stops at `caught-up`
// --after    file holding a checkpoint (the `checkpoint` of a caught-up or event frame) to replay from
// Output: one line per frame ({"kind":"event"|"caught-up"|"gap",...}), or {"error":{code,status,message}},
// then {"done":{events,frames,transport,ms}}. Exit status 0 unless the script itself failed.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i].replace(/^--/, "");
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) args[key] = true;
  else { args[key] = next; i += 1; }
}
const state = resolve(String(args.state ?? process.env.S ?? ""));
const ids = Object.fromEntries(
  readFileSync(join(state, "ids.env"), "utf8").trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const base = String(args.base ?? process.env.BASE ?? ids.BASE);
const actor = String(args.actor ?? "owner");
const transport = String(args.transport ?? "http");
const wantEvents = Number(args.events ?? 1);
const timeoutMs = Number(args.timeout ?? 8000);
const channel = String(args.channel ?? "fleet.vehicle-status");
const params = args.params !== undefined ? JSON.parse(String(args.params)) : { companyId: String(args.company ?? ids.COMPANY_A) };
const after = args.after ? JSON.parse(readFileSync(String(args.after), "utf8")) : undefined;

/** Cookie header from a curl (Netscape format) cookie jar. */
function cookieHeader(name) {
  const jar = join(state, `${name}.jar`);
  if (name === "anon" || !existsSync(jar)) return "";
  return readFileSync(jar, "utf8").split("\n")
    .map((line) => line.replace(/^#HttpOnly_/, ""))
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 7)
    .map((cols) => `${cols[5]}=${cols[6]}`)
    .join("; ");
}

const project = resolve(new URL("../..", import.meta.url).pathname);
const { createClient, createWebSocketClient } = await import(
  pathToFileURL(join(project, "node_modules", "@relkit", "client", "dist", "index.js")).href
);

let cookie = cookieHeader(actor);
const upgradeHeaders = { origin: base, ...(cookie ? { cookie } : {}) };
const identityResponse = await fetch(`${base}/_relkit/v1/client/identity`, { headers: upgradeHeaders });
const identity = await identityResponse.json();
if (cookie === "") {
  // An anonymous browser keeps the visitor cookies the identity answer sets; without them the
  // identity headers do not match and the call fails with IDENTITY_PRECONDITION_FAILED.
  cookie = identityResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  if (cookie) upgradeHeaders.cookie = cookie;
}
const headers = {
  ...upgradeHeaders,
  "x-relkit-identity-scope": identity.identityScope,
  "x-relkit-session-epoch": identity.sessionEpoch,
};

let client;
if (transport === "ws") {
  // A browser sends its cookies and Origin on the upgrade; a script has to set them itself.
  let Socket;
  if (typeof Bun !== "undefined") {
    Socket = class extends globalThis.WebSocket {
      constructor(url, protocols) { super(url, { headers: upgradeHeaders, ...(protocols ? { protocols } : {}) }); }
    };
  } else {
    const { WebSocket: Ws } = await import(pathToFileURL(join(project, "node_modules", "ws", "wrapper.mjs")).href);
    Socket = class extends Ws {
      constructor(url, protocols) { super(url, protocols, { headers: upgradeHeaders }); }
    };
  }
  client = createWebSocketClient({ baseUrl: base, headers, websocket: Socket });
} else {
  client = createClient({ baseUrl: base, headers });
}

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const controller = new AbortController();
const started = Date.now();
let frames = 0;
let events = 0;
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
try {
  const stream = await client["relkit.realtime.subscribe"](
    { channel, params, ...(after ? { after } : {}) },
    { signal: controller.signal },
  );
  for await (const frame of stream) {
    frames += 1;
    if (frame.kind === "event") events += 1;
    print(frame);
    if (wantEvents === 0 && frame.kind === "caught-up") break;
    if (wantEvents > 0 && events >= wantEvents) break;
  }
} catch (error) {
  if (!timedOut) {
    print({ error: { code: error?.code, status: error?.status, message: String(error?.message ?? error).slice(0, 300) } });
  }
} finally {
  clearTimeout(timer);
  controller.abort();
}
print({ done: { events, frames, transport, ms: Date.now() - started, timedOut } });
process.exit(0);
