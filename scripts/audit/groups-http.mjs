// Group "http": behaviour of the framework's HTTP layer itself (routing, methods, CORS, error envelope).
import { problemCode, all, isProblemJson } from "./lib.mjs";

const ENVELOPE_KEYS = ["type", "title", "status", "code", "detail", "traceId"];

/** Checks one error response against the RFC 9457 envelope the openapi document promises. */
export const envelope = (status) => (res) => {
  const problems = [];
  if (!/application\/problem\+json/i.test(res.headers["content-type"] ?? "")) problems.push(`content-type ${res.headers["content-type"] ?? "(none)"}`);
  if (!res.json || res.body === null || typeof res.body !== "object") problems.push("body is not a JSON object");
  else {
    const missing = ENVELOPE_KEYS.filter((k) => !(k in res.body));
    if (missing.length) problems.push(`missing ${missing.join(",")}`);
    if (res.body.status !== status) problems.push(`body.status=${res.body.status}`);
  }
  if (!res.headers["x-request-id"]) problems.push("no x-request-id header");
  return problems.length ? problems.join("; ") : true;
};

export async function httpGroup(audit, ctx, fx) {
  const G = "http";
  const s = (o) => audit.step({ group: G, actor: ctx.anon, basis: "http-norm", ...o });
  const owner = ctx.owner;

  // ---- /hello -------------------------------------------------------------------------------
  const helloGet = await s({ name: "GET /hello (no name)", method: "GET", path: "/hello", expect: 200, basis: "app-contract", check: 'body {"message":"Hello, world!"}', verify: (r) => (r.body?.message === "Hello, world!" ? true : `message=${r.body?.message}`) });
  await s({ name: "GET /hello?name=Mustafa", method: "GET", path: "/hello?name=Mustafa", expect: 200, basis: "app-contract", verify: (r) => (r.body?.message === "Hello, Mustafa!" ? true : `message=${r.body?.message}`) });
  await s({ name: "GET /hello?name= (empty)", method: "GET", path: "/hello?name=", expect: 422, basis: "openapi", note: "name has minLength 1", verify: envelope(422) });
  await s({ name: "GET /hello utf-8 name", method: "GET", path: "/hello?name=%D9%85%D8%B5%D8%B7%D9%81%D9%89", expect: 200, verify: (r) => (r.body?.message === "Hello, مصطفى!" ? true : `message=${r.body?.message}`) });
  await s({ name: "GET /hello content-type", method: "GET", path: "/hello", expect: 200, verify: (r) => (/^application\/json/i.test(r.headers["content-type"] ?? "") ? true : `content-type ${r.headers["content-type"]}`) });
  await s({ name: "GET /hello with Accept: text/html", method: "GET", path: "/hello", headers: { accept: "text/html" }, expect: [200, 406], note: "content negotiation: the API only produces JSON" });
  await s({ name: "GET /hello x-request-id round trip", method: "GET", path: "/hello", headers: { "x-request-id": "audit-custom-id-123" }, expect: 200, note: "does the server honour or ignore a caller-supplied request id? (either is fine; recorded)",
    verify: (r) => (r.headers["x-request-id"] ? true : "no x-request-id header at all") });

  // ---- unknown paths / wrong methods -----------------------------------------------------------
  for (const [name, path] of [["unknown path", "/nope"], ["unknown nested path", "/vehicles/abc/unknown"], ["unknown under /_relkit/v1", "/_relkit/v1/nope"], ["unknown under /api/auth", "/api/auth/nope"], ["case differs", "/VEHICLES"], ["encoded slash", "/vehicles%2Fx"], ["double slash", "//vehicles"], ["root", "/"]]) {
    await s({ name: `404 | ${name}`, method: "GET", path, expect: path === "//vehicles" ? [401, 404] : 404, check: "404 problem+json envelope", verify: path.startsWith("/api/auth") || path === "//vehicles" ? undefined : envelope(404) });
  }
  for (const [name, method, path, allowed] of [
    ["DELETE on collection", "DELETE", "/vehicles", ["GET", "POST"]],
    ["PUT on /hello", "PUT", "/hello", ["GET"]],
    ["POST on /hello", "POST", "/hello", ["GET"]],
    ["PATCH on /vehicle-models collection", "PATCH", "/vehicle-models", ["GET", "POST"]],
    ["GET on /vehicles/:id/retire", "GET", "/vehicles/abc/retire", ["POST"]],
    ["POST on /documents/:id/download", "POST", "/documents/abc/download", ["GET"]],
    ["PUT on /drivers/:id", "PUT", "/drivers/abc", ["GET", "PATCH"]],
    ["DELETE on /vehicles/:id", "DELETE", "/vehicles/abc", ["GET", "PATCH"]],
    ["GET on /vehicles/:id/status", "GET", "/vehicles/abc/status", ["PUT"]],
  ]) {
    await s({ name: `405 | ${name}`, method, path, expect: 405, check: `405 problem+json envelope, Allow lists ${allowed.join(",")}`,
      verify: all(envelope(405), (r) => { const allow = (r.headers.allow ?? "").toUpperCase(); const miss = allowed.filter((m) => !allow.includes(m)); return !allow ? "no Allow header" : miss.length ? `Allow "${r.headers.allow}" lacks ${miss.join(",")}` : true; }) });
  }
  await s({ name: "405 before 401 | DELETE /vehicles anon", method: "DELETE", path: "/vehicles", expect: 405, note: "method check happens before authentication (no information leak either way)" });

  // ---- HEAD / OPTIONS ---------------------------------------------------------------------------
  await s({ name: "HEAD /hello", method: "HEAD", path: "/hello", expect: 200, check: "no body; Content-Length equals GET's", verify: (r) => (r.bytes.byteLength !== 0 ? "HEAD returned a body" : String(r.headers["content-length"]) === String(helloGet.headers["content-length"]) ? true : `content-length ${r.headers["content-length"]} vs GET ${helloGet.headers["content-length"]} (RFC 9110 9.3.2: HEAD should send the same headers as GET)`) });
  await s({ name: "HEAD /vehicles anon", method: "HEAD", path: "/vehicles", expect: 401, check: "same status as GET without a session" });
  await s({ name: "HEAD /vehicles owner", actor: owner, method: "HEAD", path: "/vehicles", expect: 200 });
  await s({ name: "HEAD /vehicles/missing owner", actor: owner, method: "HEAD", path: "/vehicles/does-not-exist", expect: 404 });
  await s({ name: "HEAD /drivers/:id/activate (POST-only path)", actor: owner, method: "HEAD", path: "/drivers/abc/activate", expect: 405 });
  await s({ name: "OPTIONS /hello", method: "OPTIONS", path: "/hello", expect: [200, 204], check: "OPTIONS answers with Allow (RFC 9110 9.3.7)", verify: (r) => (r.headers.allow ? true : "no Allow header") });
  await s({ name: "OPTIONS /vehicles", method: "OPTIONS", path: "/vehicles", expect: [200, 204], check: "OPTIONS answers with Allow", verify: (r) => (r.headers.allow ? true : "no Allow header") });
  await s({ name: "OPTIONS /vehicles without Origin header", method: "OPTIONS", path: "/vehicles", origin: false, expect: [200, 204], check: "OPTIONS answers with Allow", verify: (r) => (r.headers.allow ? true : "no Allow header") });
  await s({ name: "OPTIONS /vehicles owner", actor: owner, method: "OPTIONS", path: "/vehicles", expect: [200, 204] });

  // ---- trailing slash -----------------------------------------------------------------------------
  for (const [path, expect] of [["/hello/", [200, 301, 308, 404]], ["/vehicles/", [200, 301, 308, 401, 404]], ["/api/auth/ok/", [200, 301, 308, 404]]]) {
    await s({ name: `trailing slash | ${path}`, method: "GET", path, actor: path === "/vehicles/" ? owner : ctx.anon, expect, note: "a router either serves, redirects or 404s; strict routing (404 for /x/) is accepted; the observed status is recorded", check: "served, redirected or strict 404; never 5xx" });
  }

  // ---- CORS -----------------------------------------------------------------------------------------
  const cors = (extra = {}) => ({ origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type", ...extra });
  const noAllowOrigin = (r) => { const v = r.headers["access-control-allow-origin"]; return v === "*" || v === "https://evil.example" ? `allows foreign origin: ${v}` : true; };
  await s({ name: "CORS preflight | evil origin on POST /vehicles", method: "OPTIONS", path: "/vehicles", headers: cors(), expect: [200, 204, 403, 404, 405], check: "never grants a foreign origin (no CORS configured in the app)", verify: all(noAllowOrigin, (r) => (r.status >= 500 ? "5xx" : true)) });
  await s({ name: "CORS preflight | evil origin on /api/auth/sign-in/email", method: "OPTIONS", path: "/api/auth/sign-in/email", headers: cors(), expect: [200, 204, 403, 404, 405], verify: noAllowOrigin });
  await s({ name: "CORS preflight | same origin", method: "OPTIONS", path: "/vehicles", headers: { origin: audit.baseUrl, "access-control-request-method": "POST", "access-control-request-headers": "content-type" }, expect: [200, 204], check: "a browser on the same origin can preflight", basis: "http-norm" });
  await s({ name: "CORS simple request | evil origin GET /hello", method: "GET", path: "/hello", headers: { origin: "https://evil.example" }, expect: 200, verify: noAllowOrigin, check: "no Access-Control-Allow-Origin for the foreign origin" });
  await s({ name: "CORS credentialed | evil origin GET /vehicles with session", actor: owner, method: "GET", path: "/vehicles", headers: { origin: "https://evil.example" }, expect: [200, 403], verify: all(noAllowOrigin, (r) => (r.headers["access-control-allow-credentials"] === "true" ? "allows credentials" : true)),
    note: "session cookie + foreign Origin on a safe method: the server answers; the browser would block reading it if no ACAO. 403 would be stricter." });
  await s({ name: "CORS state-changing | evil origin POST /vehicle-models with session", actor: owner, method: "POST", path: "/vehicle-models", headers: { origin: "https://evil.example" }, body: { make: "Evil", name: audit.modelName("E"), bodyType: "van", capacityKg: 1 }, expect: [201, 403], basis: "http-norm",
    note: "CSRF: Better Auth rejects a foreign Origin on /api/auth/*; app routes are guarded only by SameSite=Lax. 201 means the foreign-origin POST was accepted by the app route." });

  // ---- error envelope per status ---------------------------------------------------------------------
  const envelopes = [
    ["401", 401, { method: "GET", path: "/vehicles" }, "unauthenticated"],
    ["403", 403, { method: "POST", path: "/vehicle-models", actor: ctx.dispatcher, body: { make: "x", name: "y", bodyType: "van", capacityKg: 1 } }, "access-denied"],
    ["404 domain", 404, { method: "GET", path: "/vehicles/does-not-exist", actor: owner }, "fleet.vehicle-not-found"],
    ["404 route", 404, { method: "GET", path: "/definitely/not/here" }, "not-found"],
    ["405", 405, { method: "DELETE", path: "/vehicles" }, "method-not-allowed"],
    ["409", 409, { method: "POST", path: "/vehicle-models", actor: owner, body: null }, "fleet.model-exists"],
    ["413", 413, { method: "POST", path: "/vehicle-models", actor: owner, rawBody: "x".repeat(1_048_577) }, undefined],
    ["422", 422, { method: "POST", path: "/vehicle-models", actor: owner, body: { make: "", name: "", bodyType: "x", capacityKg: -1 } }, "validation"],
  ];
  const dup = await fx.model();
  for (const [name, status, req, code] of envelopes) {
    const call = { ...req };
    if (name === "409") call.body = { make: dup?.make, name: dup?.name, bodyType: "van", capacityKg: 1 };
    await s({ name: `envelope | ${name}`, ...call, expect: status, check: `application/problem+json with ${ENVELOPE_KEYS.join(",")}; body.status = ${status}; x-request-id present`, verify: all(envelope(status), code ? problemCode(code) : () => true) });
  }
  // Provoke a 500 if any input does.
  const five = [
    ["POST /vehicles plate NUL", { method: "POST", path: "/vehicles", actor: owner, body: { modelId: dup?.id, plate: `NUL\u0000${audit.next()}`, year: 2022 } }],
    ["POST /vehicle-models name NUL", { method: "POST", path: "/vehicle-models", actor: owner, body: { make: "N\u0000", name: audit.modelName("N"), bodyType: "van", capacityKg: 1 } }],
    ["POST /drivers fullName NUL", { method: "POST", path: "/drivers", actor: owner, body: { fullName: "Nul\u0000Name", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2099-01-01" } }],
    ["GET /vehicles/<NUL id>", { method: "GET", path: "/vehicles/a%00b", actor: owner }],
    ["GET /vehicles?modelId=<NUL>", { method: "GET", path: "/vehicles?modelId=a%00b", actor: owner }],
  ];
  let found = false;
  for (const [name, req] of five) {
    const res = await s({ name: `provoke 500 | ${name}`, ...req, expect: [200, 201, 400, 404, 422], check: "must not be 5xx", verify: (r) => (r.status >= 500 ? `server error ${r.status}` : true) });
    if (res.status >= 500 && !found) {
      found = true;
      await s({ name: "envelope | 500", ...req, expect: 500, check: `application/problem+json with ${ENVELOPE_KEYS.join(",")}; no stack trace / SQL in body`, verify: all(envelope(500), (r) => (/\bat\s.+\(|SELECT|INSERT|select\s|insert\s|postgres|drizzle/i.test(r.text) ? `body leaks internals: ${r.text.slice(0, 200)}` : true)) });
    }
  }

  // ---- misc robustness -------------------------------------------------------------------------------------
  await s({ name: "oversized header (20 KB)", method: "GET", path: "/hello", headers: { "x-audit-pad": "h".repeat(20_000) }, expect: [200, 400, 431], note: "must not 5xx or hang", verify: (r) => (r.status >= 500 || r.status === 0 ? `status ${r.status} ${r.error ?? ""}` : true) });
  await s({ name: "very long URL (10 KB)", method: "GET", path: `/hello?name=${"u".repeat(10_000)}`, expect: [200, 414, 431, 400] });
  await s({ name: "security header | x-content-type-options on JSON", method: "GET", path: "/hello", expect: 200, check: "x-content-type-options: nosniff", verify: (r) => (r.headers["x-content-type-options"] === "nosniff" ? true : "header absent") });
  await s({ name: "no server banner", method: "GET", path: "/hello", expect: 200, check: "no x-powered-by / server header exposing the stack", verify: (r) => (r.headers["x-powered-by"] || r.headers.server ? `x-powered-by=${r.headers["x-powered-by"]} server=${r.headers.server}` : true) });
  await s({ name: "cache-control on authenticated JSON", actor: owner, method: "GET", path: "/vehicles", expect: 200, check: "private/no-store for per-user data", verify: (r) => (/no-store|private/i.test(r.headers["cache-control"] ?? "") ? true : `cache-control: ${r.headers["cache-control"] ?? "(none)"}`) });
  await s({ name: "session cookie attributes", method: "POST", path: "/api/auth/sign-in/email", actor: new (ctx.anon.constructor)("cookie-probe"), body: { email: ctx.owner.email, password: "correct-horse-battery" }, expect: 200,
    check: "HttpOnly; SameSite; Path=/; Max-Age", verify: (r) => { const c = (r.headers["set-cookie"] ?? []).find((x) => x.startsWith("better-auth.session_token")); return !c ? "no session cookie" : /HttpOnly/i.test(c) && /SameSite/i.test(c) ? true : `attributes: ${c}`; } });
}
