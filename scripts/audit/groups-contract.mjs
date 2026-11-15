// Group "contract": compare everything observed during the run with the generated OpenAPI document.
// Also cross-cutting observation rows (error envelope consistency, request ids).

/** Minimal JSON-schema validator for the subset openapi.json uses. Returns a list of problems. */
export function validate(schema, value, path = "$", out = []) {
  if (schema === undefined || schema === true) return out;
  if (schema.oneOf || schema.anyOf) {
    const branches = schema.oneOf ?? schema.anyOf;
    // Prefer the branch whose discriminating "code" const matches.
    const results = branches.map((b) => validate(b, value, path, []));
    if (!results.some((r) => r.length === 0)) {
      const best = results.map((r, i) => ({ r, i })).sort((a, b) => a.r.length - b.r.length)[0];
      out.push(`${path}: no ${schema.oneOf ? "oneOf" : "anyOf"} branch matches (closest: ${best.r.slice(0, 3).join("; ")})`);
    } else if (schema.oneOf && results.filter((r) => r.length === 0).length > 1) {
      out.push(`${path}: matches more than one oneOf branch`);
    }
    return out;
  }
  if (schema.allOf) for (const b of schema.allOf) validate(b, value, path, out);
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) out.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) out.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  const types = schema.type === undefined ? undefined : Array.isArray(schema.type) ? schema.type : [schema.type];
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (types) {
    const ok = types.some((t) => t === actualType || (t === "number" && (actualType === "integer" || actualType === "number")));
    if (!ok) {
      out.push(`${path}: type ${actualType}, expected ${types.join("|")}`);
      return out;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${path}: shorter than minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: longer than maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: above maximum`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, out));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) out.push(`${path}.${key}: required property missing`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in value) validate(sub, value[key], `${path}.${key}`, out);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) out.push(`${path}.${key}: property not declared (additionalProperties:false)`);
  }
  return out;
}

const templateRegex = (template) => new RegExp("^" + template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}/g, "[^/]+") + "$");
const media = (ct) => (ct ?? "").split(";")[0].trim().toLowerCase();

export async function contractGroup(audit, ctx, fx) {
  const G = "contract";
  let spec = ctx.openapi;
  if (!spec) {
    const res = await audit.step({ group: G, name: "fetch openapi.json", actor: ctx.anon, method: "GET", path: "/_relkit/v1/openapi.json", expect: 200, basis: "relkit-docs" });
    spec = res.json ? res.body : undefined;
  }
  if (!spec) return;

  const ops = [];
  for (const [template, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) ops.push({ template, method: method.toUpperCase(), op, regex: templateRegex(template), calls: [] });
  }
  // longest/most specific templates first so /vehicles/{id}/status wins over /vehicles/{id}
  const byLiteral = [...ops].sort((a, b) => b.template.replace(/\{[^}]+\}/g, "").length - a.template.replace(/\{[^}]+\}/g, "").length);
  for (const o of audit.observed) {
    const match = byLiteral.find((x) => x.method === o.method && x.regex.test(o.pathname));
    if (match) match.calls.push(o);
  }

  const fail = (name, o) => audit.record({
    id: `${G}:${name}`, group: G, name, actor: "-", method: o.method, path: o.template, requestHeaders: {}, basis: "openapi",
    expected: o.expected, actual: { status: o.status ?? 0, headers: {}, body: o.body ?? null, durationMs: 0 }, requestId: null, pass: false, note: o.note,
  });

  const uncalledAuth = [];
  let checkedSuccess = 0;
  let checkedErrors = 0;
  for (const x of ops) {
    const label = `${x.method} ${x.template}`;
    if (x.calls.length === 0) {
      const isApp = !x.template.startsWith("/api/auth");
      if (isApp) {
        fail(`uncalled | ${label}`, { method: x.method, template: x.template, expected: { status: "called at least once" }, note: "APPLICATION route declared in openapi.json but never called by the harness" });
      } else uncalledAuth.push(label);
      continue;
    }
    const declared = Object.keys(x.op.responses ?? {});
    const statuses = new Map();
    for (const c of x.calls) statuses.set(c.status, [...(statuses.get(c.status) ?? []), c]);
    for (const [status, calls] of statuses) {
      if (status === 0) continue;
      const decl = x.op.responses?.[String(status)];
      if (!decl && !x.op.responses?.default) {
        fail(`status-undeclared | ${label} -> ${status}`, { method: x.method, template: x.template, status, expected: { status: `one of ${declared.join(",")}`, check: "every observed status is declared" },
          note: `${calls.length} observation(s), e.g. rows ${calls.slice(0, 3).map((c) => c.rowId).join(" ; ")}`, body: calls[0].body });
        continue;
      }
      // content type
      const content = decl?.content;
      if (content) {
        const bad = calls.filter((c) => c.contentType && !Object.keys(content).some((k) => media(k) === media(c.contentType)));
        if (bad.length) fail(`content-type | ${label} -> ${status}`, { method: x.method, template: x.template, status, expected: { status, check: `content-type in ${Object.keys(content).join(", ")}` }, note: `observed ${[...new Set(bad.map((c) => c.contentType))].join(", ")} in ${bad.length} call(s), e.g. ${bad[0].rowId}` });
      }
      // body shape
      const jsonContent = content ? Object.entries(content).find(([k]) => /json/.test(k))?.[1] : undefined;
      if (jsonContent?.schema) {
        const seen = new Set();
        for (const c of calls) {
          if (c.body === undefined) continue;
          const problems = validate(jsonContent.schema, c.body);
          if (status >= 200 && status < 300) checkedSuccess += 1; else checkedErrors += 1;
          if (problems.length) {
            const key = problems[0].replace(/\[\d+\]/g, "[]");
            if (seen.has(key)) continue;
            seen.add(key);
            fail(`${status < 300 ? "success-body" : "error-body"} | ${label} -> ${status}`, { method: x.method, template: x.template, status, expected: { status, check: `body validates against the declared ${status} schema` }, body: c.body, note: `${problems.slice(0, 4).join(" ; ")} (row ${c.rowId})` });
          }
        }
      }
    }
  }

  if (uncalledAuth.length) {
    audit.record({
      id: `${G}:uncalled-better-auth-operations`, group: G, name: "uncalled-better-auth-operations", actor: "-", method: "-", path: "/api/auth/* (declared in openapi.json)", requestHeaders: {}, basis: "openapi",
      expected: { status: "every declared operation called at least once" }, actual: { status: 0, headers: {}, body: uncalledAuth, durationMs: 0 }, requestId: null, pass: false,
      note: `${uncalledAuth.length} Better Auth operations are declared but outside the required coverage list (social sign-in, password reset, e-mail verification, session revocation, invitation cancel/reject, role update, ...); aggregated into this one row`,
    });
  }

  // methods that the server answers with 2xx although openapi.json does not declare them (HEAD, OPTIONS ...)
  const undeclared = new Map();
  for (const o of audit.observed) {
    if (o.status < 200 || o.status >= 300) continue;
    const anyOp = byLiteral.find((x) => x.regex.test(o.pathname));
    if (!anyOp || ops.some((x) => x.method === o.method && x.regex.test(o.pathname))) continue;
    const key = `${o.method} ${anyOp.template}`;
    undeclared.set(key, [...(undeclared.get(key) ?? []), o]);
  }
  for (const [key, calls] of undeclared) {
    const [method, template] = key.split(" ");
    fail(`method-undeclared | ${key} -> ${calls[0].status}`, { method, template, status: calls[0].status, expected: { status: "declared in openapi.json", check: "every method the server answers with 2xx is declared" }, note: `served ${calls.length} time(s), e.g. ${calls[0].rowId}` });
  }

  // ---------------------------------------------------------------- cross-cutting observations
  const errorShapes = new Map();
  for (const o of audit.observed) {
    if (o.status < 400 || o.status === 0) continue;
    const keys = o.body && typeof o.body === "object" ? Object.keys(o.body).sort().join(",") : `(non-JSON ${media(o.contentType) || "no content-type"})`;
    const key = `${media(o.contentType) || "none"} | ${keys}`;
    const entry = errorShapes.get(key) ?? { count: 0, example: o, statuses: new Set() };
    entry.count += 1;
    entry.statuses.add(o.status);
    errorShapes.set(key, entry);
  }
  const shapeList = [...errorShapes].map(([k, v]) => `[${v.count}x, statuses ${[...v.statuses].sort().join("/")}] ${k} e.g. ${v.example.method} ${v.example.pathname} (${v.example.rowId})`);
  audit.record({
    id: `${G}:error-envelope-consistency`, group: G, name: "error-envelope-consistency", actor: "-", method: "-", path: "all error responses of the run", requestHeaders: {},
    expected: { status: "one envelope", check: "every 4xx/5xx has the same shape (RFC 9457 problem+json with type,title,status,code,detail,traceId)" }, basis: "http-norm",
    actual: { status: 0, headers: {}, body: shapeList, durationMs: 0 }, requestId: null, pass: errorShapes.size <= 1,
    note: `${errorShapes.size} distinct error shapes across ${[...errorShapes.values()].reduce((n, v) => n + v.count, 0)} error responses`,
  });

  const noId = audit.observed.filter((o) => o.status > 0 && !o.hasRequestIdHeader);
  const noIdByPath = {};
  for (const o of noId) { const k = `${o.method} ${o.pathname.replace(/\/[0-9a-f-]{20,}/g, "/:id")}`; noIdByPath[k] = (noIdByPath[k] ?? 0) + 1; }
  audit.record({
    id: `${G}:x-request-id-on-every-response`, group: G, name: "x-request-id-on-every-response", actor: "-", method: "-", path: "all responses of the run", requestHeaders: {},
    expected: { status: "header present", check: "every response carries x-request-id" }, basis: "http-norm",
    actual: { status: 0, headers: {}, body: { responsesWithoutId: noId.length, of: audit.observed.length, examples: Object.entries(noIdByPath).slice(0, 25) }, durationMs: 0 }, requestId: null, pass: noId.length === 0,
    note: noId.length ? `${noId.length} of ${audit.observed.length} responses had no x-request-id header` : undefined,
  });

  const mismatched = audit.rows.filter((r) => r.traceId && r.actual?.headers?.["x-request-id"]);
  audit.record({
    id: `${G}:request-id-header-equals-body-traceId`, group: G, name: "request-id-header-equals-body-traceId", actor: "-", method: "-", path: "all problem responses", requestHeaders: {},
    expected: { status: "equal", check: "x-request-id header and body.traceId identify the same request" }, basis: "http-norm",
    actual: { status: 0, headers: {}, body: { differing: mismatched.length, example: mismatched[0] ? { rowId: mismatched[0].id, header: mismatched[0].actual.headers["x-request-id"], traceId: mismatched[0].traceId } : null }, durationMs: 0 }, requestId: null, pass: mismatched.length === 0,
    note: mismatched.length ? "the header is request-<uuid>, the body traceId is a 32-hex trace id: two different identifiers for one request; support has to know to search either" : undefined,
  });

  audit.record({
    id: `${G}:coverage-summary`, group: G, name: "coverage-summary", actor: "-", method: "-", path: "openapi.json", requestHeaders: {},
    expected: { status: "info" }, basis: "openapi", actual: { status: 0, headers: {}, body: { declaredOperations: ops.length, applicationOperations: ops.filter((o) => !o.template.startsWith("/api/auth")).length, calledOperations: ops.filter((o) => o.calls.length).length, bodiesValidated: { success: checkedSuccess, error: checkedErrors } }, durationMs: 0 }, requestId: null, pass: true,
  });
}
