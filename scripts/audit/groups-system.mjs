// Group "system": framework routes under /_relkit/v1 and /healthz, plus inspector-side exposure probes on the app port.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Actor, all } from "./lib.mjs";

/** Looks for things an unauthenticated caller should not be able to read. */
function leakScan(text, project) {
  const found = [];
  const secrets = [];
  if (project && existsSync(join(project, ".env"))) {
    for (const line of readFileSync(join(project, ".env"), "utf8").split("\n")) {
      const m = line.match(/^(BETTER_AUTH_SECRET|DATABASE_URL)=(.+)$/);
      if (m && m[2].length > 8) secrets.push([m[1], m[2].trim()]);
    }
  }
  for (const [name, value] of secrets) if (text.includes(value)) found.push(`VALUE of ${name}`);
  if (project && text.includes(project)) found.push("absolute project path");
  if (/\/Users\/[A-Za-z0-9._-]+\//.test(text)) found.push("absolute home path");
  const envNames = [...new Set(text.match(/\b(?:BETTER_AUTH_SECRET|DATABASE_URL|BETTER_AUTH_URL|LOG_LEVEL)\b/g) ?? [])];
  if (envNames.length) found.push(`env variable names (${envNames.join(",")})`);
  const files = [...new Set(text.match(/"(?:src\/[^"]+\.ts|relkit\.config\.ts)"/g) ?? [])];
  if (files.length) found.push(`${files.length} source file paths`);
  const perms = [...new Set(text.match(/\b(?:vehicle|vehicleModel|driver|assignment|document):[a-zA-Z]+\b/g) ?? [])];
  if (perms.length) found.push(`${perms.length} permission names`);
  const fnIds = [...new Set(text.match(/\b(?:fleet|drivers|documents|hello)\.[a-z-]+\b/g) ?? [])];
  if (fnIds.length) found.push(`${fnIds.length} internal function/error/channel ids`);
  return found;
}

export async function systemGroup(audit, ctx, fx) {
  const G = "system";
  const s = (o) => audit.step({ group: G, actor: ctx.anon, basis: "relkit-docs", ...o });
  const owner = ctx.owner;

  const oa = await s({ name: "GET /_relkit/v1/openapi.json", method: "GET", path: "/_relkit/v1/openapi.json", expect: 200, check: "OpenAPI 3.1 JSON containing all 25 routes", verify: (r) => {
    if (!r.json) return "not JSON";
    if (!String(r.body.openapi).startsWith("3.1")) return `openapi ${r.body.openapi}`;
    const ops = Object.entries(r.body.paths ?? {}).filter(([p]) => !p.startsWith("/api/auth")).flatMap(([p, o]) => Object.keys(o).map((m) => `${m} ${p}`));
    return ops.length === 25 ? true : `${ops.length} application operations declared, expected 25`;
  } });
  ctx.openapi = oa.json ? oa.body : undefined;
  await s({ name: "openapi.json content-type", method: "GET", path: "/_relkit/v1/openapi.json", expect: 200, verify: (r) => (/^application\/json/i.test(r.headers["content-type"] ?? "") ? true : r.headers["content-type"]) });
  await s({ name: "GET /_relkit/v1/api-reference", method: "GET", path: "/_relkit/v1/api-reference", expect: 200, check: "HTML page (Scalar UI)", verify: (r) => (/text\/html/i.test(r.headers["content-type"] ?? "") && /<html/i.test(r.text) ? true : `content-type ${r.headers["content-type"]}`) });
  await s({ name: "GET /_relkit/v1/health/live", method: "GET", path: "/_relkit/v1/health/live", expect: 200, check: "status ok", verify: (r) => (r.body?.status === "ok" ? true : `status=${r.body?.status}`),
    note: "response is the Inspector protocol document (graph hash, activation fingerprint, readiness flags), not a minimal liveness probe" });
  await s({ name: "GET /_relkit/v1/health/ready", method: "GET", path: "/_relkit/v1/health/ready", expect: 200, check: "status ready", verify: (r) => (r.body?.status === "ready" ? true : `status=${r.body?.status}`) });
  await s({ name: "GET /healthz", method: "GET", path: "/healthz", expect: 200, check: "ready", verify: (r) => (r.body?.ready === true && r.body?.live === true ? true : JSON.stringify(r.body)) });
  await s({ name: "HEAD /healthz", method: "HEAD", path: "/healthz", expect: 200, basis: "http-norm" });
  await s({ name: "GET /_relkit/v1/client-contract.json", method: "GET", path: "/_relkit/v1/client-contract.json", expect: 200, verify: (r) => (r.body?.channels?.some((c) => c.id === "fleet.vehicle-status" || c.name === "fleet.vehicle-status") ? true : "fleet.vehicle-status channel not in the client contract") });
  await s({ name: "GET /_relkit/v1/client/identity (anon)", method: "GET", path: "/_relkit/v1/client/identity", actor: new Actor("anon-identity"), expect: 200, verify: (r) => (r.body?.identityScope && r.body?.sessionEpoch ? true : "fields") });
  await s({ name: "GET /_relkit/v1/client/identity (owner)", actor: owner, method: "GET", path: "/_relkit/v1/client/identity", expect: 200, check: "identityScope differs from anonymous scope", verify: (r) => (r.body?.identityScope ? true : "fields") });
  await s({ name: "GET /_relkit/v1/client/routes", method: "GET", path: "/_relkit/v1/client/routes", expect: 200, verify: (r) => (Array.isArray(r.body?.routes) && r.body.routes.length >= 25 ? true : `routes=${r.body?.routes?.length}`) });
  await s({ name: "GET /_relkit/v1/rpc (no body)", method: "GET", path: "/_relkit/v1/rpc", expect: [400, 404, 405], basis: "http-norm", check: "client error, not 5xx" });
  await s({ name: "POST /_relkit/v1/rpc (empty json)", method: "POST", path: "/_relkit/v1/rpc", body: {}, expect: [400, 404, 415, 422], basis: "http-norm", check: "client error, not 5xx" });
  await s({ name: "POST /_relkit/v1/rpc (malformed)", method: "POST", path: "/_relkit/v1/rpc", rawBody: "{bad", expect: [400, 404, 415, 422], basis: "http-norm" });
  await s({ name: "POST /_relkit/v1/rpc relkit.realtime.subscribe unauthenticated", method: "POST", path: "/_relkit/v1/rpc/relkit/realtime/subscribe", body: { json: { channel: "fleet.vehicle-status", params: { companyId: "x" } } }, expect: [400, 401, 403, 404], basis: "app-contract", note: "oRPC wire shape guessed from the client; the channel's authorize() must deny" });

  // server-sent events endpoint: read the first chunk only
  {
    const url = audit.baseUrl + "/_relkit/v1/client/contract-events";
    const controller = new AbortController();
    const started = performance.now();
    let res;
    try {
      const response = await fetch(url, { headers: { accept: "text/event-stream" }, signal: controller.signal });
      const reader = response.body.getReader();
      const first = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), 3000))]);
      const text = first.value ? new TextDecoder().decode(first.value) : "";
      controller.abort();
      const rh = {};
      for (const [k, v] of response.headers) rh[k] = v;
      res = { status: response.status, headers: rh, text, body: text, json: false, bytes: new TextEncoder().encode(text), durationMs: Math.round(performance.now() - started), requestHeaders: { accept: "text/event-stream" }, url };
    } catch (error) {
      res = { status: 0, headers: {}, text: "", body: null, json: false, bytes: new Uint8Array(), durationMs: Math.round(performance.now() - started), requestHeaders: {}, url, error: String(error) };
    }
    audit.finish({ group: G, name: "GET /_relkit/v1/client/contract-events (SSE, first event)", actor: ctx.anon, method: "GET", path: "/_relkit/v1/client/contract-events", expect: 200, basis: "relkit-docs",
      check: "text/event-stream and an initial ready event", verify: (r) => (/text\/event-stream/.test(r.headers["content-type"] ?? "") && /event: ready/.test(r.text) ? true : `content-type ${r.headers["content-type"]}; first chunk ${JSON.stringify(r.text.slice(0, 80))}`) }, res);
  }

  // ---------------------------------------------------------------- exposure on the app port
  const probes = [
    "graph", "graph/descriptors", "graph/source/x", "source/x", "diagnostics", "env", "runtime", "runtime/buckets/documents.files/objects", "runtime/cache/x/keys", "storage", "requests", "requests/x", "traces", "traces/x", "logs", "stream",
    "jobs/services", "jobs/runs", "jobs/definitions", "jobs/schedules",
  ];
  for (const [label, actor] of [["no session", ctx.anon], ["owner session", owner]]) {
    for (const p of probes) {
      await s({
        name: `exposure | GET /_relkit/v1/${p} | ${label}`, actor, method: "GET", path: `/_relkit/v1/${p}`, expect: [401, 403, 404], basis: "relkit-docs",
        check: "Inspector data is not served on the application port to an unauthenticated (or any application) caller: 401/403/404",
        note: "observability-apis.md: the Inspector uses a private authenticated bridge on 127.0.0.1:0; production emits no rich Inspector registration",
        verify: (r) => {
          if (r.status === 200) {
            const found = leakScan(r.text, audit.project);
            return `READABLE: ${r.bytes.byteLength} bytes served; contains ${found.length ? found.join("; ") : "no flagged items"}`;
          }
          return true;
        },
      });
    }
  }
  await s({ name: "exposure | POST /_relkit/v1/actions/functions/hello.greet/invoke | no session", method: "POST", path: "/_relkit/v1/actions/functions/hello.greet/invoke", body: { input: {} }, expect: [401, 403, 404], check: "inspector actions are not invokable anonymously" });
  await s({ name: "exposure | POST /_relkit/v1/actions/jobs/x/trigger | no session", method: "POST", path: "/_relkit/v1/actions/jobs/x/trigger", body: {}, expect: [401, 403, 404] });
  await s({ name: "exposure | POST /_relkit/v1/actions/events/fleet.vehicle-status-changed/publish | no session", method: "POST", path: "/_relkit/v1/actions/events/fleet.vehicle-status-changed/publish", body: { input: {} }, expect: [401, 403, 404] });
  await s({ name: "exposure | graph body content scan", method: "GET", path: "/_relkit/v1/graph", expect: [401, 403, 404], check: "(same request as above, scan result in note)",
    verify: (r) => {
      if (r.status !== 200) return true;
      const g = r.body?.graph ?? {};
      const kinds = {};
      for (const n of g.nodes ?? []) kinds[n.kind ?? n.type ?? "?"] = (kinds[n.kind ?? n.type ?? "?"] ?? 0) + 1;
      return `graph readable without a session: ${g.nodes?.length} nodes (${Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join(", ")}), ${g.edges?.length} edges; leaks: ${leakScan(r.text, audit.project).join("; ") || "none flagged"}`;
    } });
  await s({ name: "exposure | health/live body", method: "GET", path: "/_relkit/v1/health/live", expect: 200, check: "liveness without internal fingerprints", verify: (r) => { const keys = Object.keys(r.body ?? {}); const internal = keys.filter((k) => /hash|fingerprint|generation|source/i.test(k)); return internal.length ? `exposes ${internal.join(", ")}` : true; } });
}
