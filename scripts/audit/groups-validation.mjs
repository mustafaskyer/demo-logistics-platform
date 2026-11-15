// Group "validation": edge inputs on every route that takes input.
import { problemCode, all, isProblemJson } from "./lib.mjs";

const MAX_BODY = 1_048_576;

function padded(obj, targetBytes) {
  // JSON body of exactly targetBytes bytes by padding an extra string field.
  const base = JSON.stringify({ ...obj, pad: "" });
  const need = targetBytes - Buffer.byteLength(base);
  return JSON.stringify({ ...obj, pad: "a".repeat(Math.max(0, need)) });
}

export async function validationGroup(audit, ctx, fx) {
  const G = "validation";
  const owner = ctx.owner;
  const s = (o) => audit.step({ group: G, actor: owner, basis: "http-norm", ...o });
  const v422 = all(problemCode("validation"), isProblemJson, (r) => (Array.isArray(r.body?.issues) && r.body.issues.length > 0 ? true : "422 body has no issues[]"));

  const model = await fx.model();
  const vehicle = await fx.vehicle(model?.id);
  const driver = await fx.driver();

  // body routes: valid(): fresh valid body, fields: bad value table
  const bodyRoutes = [
    {
      key: "POST /vehicle-models", method: "POST", path: () => "/vehicle-models", okStatus: 201,
      valid: () => ({ make: "Val", name: audit.modelName("V"), bodyType: "van", capacityKg: 1000 }), required: ["make", "name", "bodyType", "capacityKg"],
      bad: { make: ["", "x".repeat(61), 5, null, ["a"], {}], name: ["", "y".repeat(61), 5, null], bodyType: ["boat", "", 5, null, "VAN"], capacityKg: [0, -1, 100001, 1.5, "3500", null, 1e21, true] },
    },
    {
      key: "PATCH /vehicle-models/:id", method: "PATCH", path: () => `/vehicle-models/${model?.id}`, okStatus: 200,
      valid: () => ({ capacityKg: 2000 }), required: [],
      bad: { make: ["", 5], name: ["", 5], bodyType: ["boat", 5], capacityKg: [0, 100001, 1.5, "1", null] },
    },
    {
      key: "POST /vehicles", method: "POST", path: () => "/vehicles", okStatus: 201,
      valid: () => ({ modelId: model?.id, plate: audit.plate(), year: 2022 }), required: ["modelId", "plate", "year"],
      bad: { modelId: ["", 5, null], plate: ["A", "P".repeat(17), 5, null, "   "], vin: ["TOO-SHORT", "1HGCM82633A00435I", "1HGCM82633A00435O", "1HGCM82633A00435Q", "", 5, "1HGCM82633A0043521"], year: [1979, 2999, 2021.5, "2021", null, 0, -5] },
    },
    {
      key: "PATCH /vehicles/:id", method: "PATCH", path: () => `/vehicles/${vehicle?.id}`, okStatus: 200,
      valid: () => ({ year: 2021 }), required: [],
      bad: { modelId: ["", 5], plate: ["A", "P".repeat(17), 5], vin: ["TOO-SHORT", 5], year: [1979, 2999, 2021.5, "2021"] },
    },
    {
      key: "PUT /vehicles/:id/status", method: "PUT", path: () => `/vehicles/${vehicle?.id}/status`, okStatus: [200, 409],
      valid: () => ({ status: "maintenance" }), required: ["status"],
      bad: { status: ["retired", "flying", "", 5, null, "Active", ["active"]] },
    },
    {
      key: "POST /drivers", method: "POST", path: () => "/drivers", okStatus: 201,
      valid: () => ({ fullName: "Val Driver", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2099-01-01" }), required: ["fullName", "phone", "licenseNumber", "licenseClass", "licenseExpiresOn"],
      bad: { fullName: ["A", "n".repeat(121), 5, null], phone: ["abc", "123", "+" + "1".repeat(25), 5, null], licenseNumber: ["X", "L".repeat(33), 5, null], licenseClass: ["", "C".repeat(9), 5, null], licenseExpiresOn: ["2099-02-30", "01/01/2099", "2099-1-1", "20990101", 5, null, "2099-13-01"], userId: ["", 5] },
    },
    {
      key: "PATCH /drivers/:id", method: "PATCH", path: () => `/drivers/${driver?.id}`, okStatus: 200,
      valid: () => ({ fullName: "Val Renamed" }), required: [],
      bad: { fullName: ["A", 5], phone: ["abc", 5], licenseNumber: ["X", 5], licenseClass: ["", 5], licenseExpiresOn: ["2099-02-30", 5] },
    },
    {
      key: "POST /driver-assignments", method: "POST", path: () => "/driver-assignments", okStatus: [201, 409],
      valid: () => ({ driverId: driver?.id, vehicleId: vehicle?.id }), required: ["driverId", "vehicleId"],
      bad: { driverId: ["", 5, null], vehicleId: ["", 5, null] },
    },
    {
      key: "POST /documents", method: "POST", path: () => "/documents", okStatus: 201,
      valid: () => ({ ownerType: "driver", ownerId: driver?.id, kind: "license", filename: "v.pdf", contentType: "application/pdf", sizeBytes: 100 }), required: ["ownerType", "ownerId", "kind", "filename", "contentType", "sizeBytes"],
      bad: { ownerType: ["company", "", 5, null], ownerId: ["", 5, null], kind: ["selfie", "", 5, null], filename: ["", "f".repeat(201), 5, null, "   "], contentType: ["text/plain", "application/x-msdownload", "", 5, null, "image/gif"], sizeBytes: [0, -1, 5_000_001, 1.5, "100", null, 1e21] },
    },
  ];

  const label = (v) => (typeof v === "string" ? (v.length > 12 ? `str${v.length}` : JSON.stringify(v)) : JSON.stringify(v) ?? String(v));

  for (const r of bodyRoutes) {
    const k = r.key;
    // missing required fields
    for (const field of r.required) {
      const body = r.valid();
      delete body[field];
      await s({ name: `${k} | missing ${field}`, method: r.method, path: r.path(), body, expect: 422, verify: v422, check: "422 problem+json with issues[]" });
    }
    // bad values
    for (const [field, values] of Object.entries(r.bad)) {
      for (const value of values) {
        const body = r.valid();
        body[field] = value;
        await s({ name: `${k} | ${field}=${label(value)}`, method: r.method, path: r.path(), body, expect: 422, verify: v422 });
      }
    }
    // structural
    await s({ name: `${k} | empty object`, method: r.method, path: r.path(), body: {}, expect: r.required.length ? 422 : r.okStatus, verify: r.required.length ? v422 : undefined, note: r.required.length ? undefined : "all fields optional: empty patch is valid" });
    await s({ name: `${k} | zero-length body`, method: r.method, path: r.path(), rawBody: "", expect: r.required.length ? [400, 422] : [400, 422, r.okStatus].flat(), note: "content-type json, no bytes", check: "client error with a problem body, never 5xx" });
    await s({ name: `${k} | malformed json`, method: r.method, path: r.path(), rawBody: "{bad", expect: 400, check: "400; error body", verify: (res) => (res.json || res.text ? true : "empty error body") });
    await s({ name: `${k} | truncated json`, method: r.method, path: r.path(), rawBody: '{"make":"x","na', expect: 400 });
    await s({ name: `${k} | json null`, method: r.method, path: r.path(), rawBody: "null", expect: [400, 422], note: "valid JSON but not an object" });
    await s({ name: `${k} | json array`, method: r.method, path: r.path(), rawBody: "[]", expect: [400, 422] });
    await s({ name: `${k} | json string`, method: r.method, path: r.path(), rawBody: '"hello"', expect: [400, 422] });
    await s({ name: `${k} | content-type text/plain`, method: r.method, path: r.path(), rawBody: JSON.stringify(r.valid()), headers: { "content-type": "text/plain" }, expect: 415, check: "415 Unsupported Media Type (RFC 9110)" });
    await s({ name: `${k} | content-type form-urlencoded`, method: r.method, path: r.path(), rawBody: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" }, expect: 415 });
    await s({ name: `${k} | no content-type`, method: r.method, path: r.path(), rawBody: JSON.stringify(r.valid()), headers: { "content-type": null }, expect: [400, 415, 422], note: "body present, header absent" });
    await s({ name: `${k} | content-type json with charset`, method: r.method, path: r.path(), rawBody: JSON.stringify(r.valid()), headers: { "content-type": "application/json; charset=utf-8" }, expect: r.okStatus, basis: "http-norm", note: "must be treated as JSON" });
    await s({ name: `${k} | extra unknown field`, method: r.method, path: r.path(), body: { ...r.valid(), unknownField: "x", organizationId: "forged-tenant", id: "forged-id" }, expect: r.okStatus, basis: "openapi",
      note: "openapi request schema has no additionalProperties:false; Zod object strips. organizationId/id in the body must NOT be honoured (verified separately where applicable)",
      verify: (res) => (res.body && typeof res.body === "object" && (res.body.organizationId === "forged-tenant" || res.body.id === "forged-id") ? "forged field was honoured" : true) });
    for (const field of Object.keys(r.valid()).filter((f) => typeof r.valid()[f] === "string")) {
      const body = r.valid();
      body[field] = `${body[field]}\u0000z`;
      await s({ name: `${k} | nul byte in ${field}`, method: r.method, path: r.path(), body, expect: [400, 404, 409, 422], check: "client error, never 5xx (\\u0000 cannot be stored by Postgres text)", verify: (res) => (res.status >= 500 ? `server error ${res.status}: ${res.text.slice(0, 160)}` : true) });
    }
    await s({ name: `${k} | 100KB string field`, method: r.method, path: r.path(), body: bigStringBody(r, 100_000), expect: [422, 400, 413, 404, 409], check: "rejected or handled as a normal not-found/conflict, never 5xx", verify: (res) => (res.status >= 500 ? `server error ${res.status}` : true) });
    await s({ name: `${k} | body = maxBodyBytes exactly`, method: r.method, path: r.path(), rawBody: padded(r.valid(), MAX_BODY), expect: r.okStatus, basis: "relkit-docs", note: "server.maxBodyBytes = 1_048_576 (relkit.config.ts); a body of exactly that size is within the limit" });
    await s({ name: `${k} | body over maxBodyBytes`, method: r.method, path: r.path(), rawBody: padded(r.valid(), MAX_BODY + 1), expect: 413, basis: "relkit-docs", note: "1_048_577 bytes", check: "413 Payload Too Large", verify: (res) => (res.status === 413 ? true : `status ${res.status}`) });
    await s({ name: `${k} | body 2 MiB`, method: r.method, path: r.path(), rawBody: padded(r.valid(), 2 * MAX_BODY), expect: 413, basis: "relkit-docs" });
  }

  function bigStringBody(r, n) {
    const body = r.valid();
    const field = r.required.find((f) => typeof body[f] === "string") ?? Object.keys(body).find((f) => typeof body[f] === "string") ?? Object.keys(r.bad).find((f) => r.bad[f].some((v) => typeof v === "string"));
    return { ...body, [field]: "z".repeat(n) };
  }

  // ---------------------------------------------------------------- query values
  const pageRoutes = ["/vehicle-models", "/vehicles", "/drivers"];
  const pageCases = [["limit=0", 422], ["limit=101", 422], ["limit=-1", 422], ["limit=abc", 422], ["limit=1.5", 422], ["limit=", 422], ["limit=%20", 422], ["offset=-1", 422], ["offset=abc", 422], ["offset=1.5", 422], ["offset=", 200], ["limit=1e2", 200], ["limit=100", 200], ["limit=1", 200], ["limit=10&limit=20", [200, 422]], ["limit=0x10", [200, 422]], ["limit=Infinity", 422], ["limit=99999999999999999999", 422], ["unknown=1", 200]];
  for (const path of pageRoutes) {
    for (const [query, expect] of pageCases) {
      const note = ["offset=", "limit=1e2", "limit=10&limit=20", "limit=0x10", "unknown=1"].includes(query)
        ? "ambiguous: z.coerce.number() semantics (Number('') = 0, Number('1e2') = 100); recorded as observation" : undefined;
      await s({ name: `GET ${path}?${query}`, method: "GET", path: `${path}?${query}`, expect, note });
    }
  }
  const enumCases = [
    ["/vehicles?status=flying", 422], ["/vehicles?status=", 422], ["/vehicles?status=ACTIVE", 422], ["/vehicles?modelId=", 422], ["/vehicles?status=active&status=retired", [200, 422]],
    ["/drivers?status=flying", 422], ["/drivers?status=", 422], ["/driver-assignments?includeClosed=yes", 422], ["/driver-assignments?includeClosed=TRUE", 422], ["/driver-assignments?includeClosed=", 422], ["/driver-assignments?includeClosed=true", 200], ["/driver-assignments?includeClosed=false", 200],
    ["/documents", 422], ["/documents?ownerType=driver", 422], [`/documents?ownerId=${driver?.id}`, 422], [`/documents?ownerType=company&ownerId=${driver?.id}`, 422], ["/documents?ownerType=driver&ownerId=", 422], ["/documents?ownerType=driver&ownerId=does-not-exist", 200], [`/documents?ownerType=vehicle&ownerId=${driver?.id}`, 200],
    ["/hello?name=", 422], ["/hello?name=%00", [200, 400, 422]], [`/hello?name=${"n".repeat(5000)}`, 200], ["/hello?name=a&name=b", [200, 422]], ["/hello?name=%F0%9F%9A%9A", 200], ["/hello?unknown=1", 200], ["/hello?name=%3Cscript%3E", 200], ["/hello?name=%ff", [200, 400, 422]],
  ];
  for (const [path, expect] of enumCases) {
    const shown = path.replaceAll(driver?.id ?? "\u0000none", "<driverId>");
    await s({ name: `GET ${shown.length > 80 ? shown.slice(0, 40) + "…(" + shown.length + ")" : shown}`, method: "GET", path, expect, verify: expect === 422 ? v422 : undefined });
  }

  // ---------------------------------------------------------------- path ids
  const ids = [["not-a-valid-id", "plain"], ["%20", "space"], ["%00", "nul"], ["x".repeat(5000), "5000chars"], ["%E2%9C%93", "unicode"], ["'%20OR%201%3D1--", "sql"], ["..%2F..%2Fetc%2Fpasswd", "traversal"], ["%25", "percent"]];
  const idRoutes = [
    ["PATCH /vehicle-models/:id", "PATCH", (id) => `/vehicle-models/${id}`, { capacityKg: 1 }],
    ["DELETE /vehicle-models/:id", "DELETE", (id) => `/vehicle-models/${id}`],
    ["GET /vehicles/:id", "GET", (id) => `/vehicles/${id}`],
    ["PATCH /vehicles/:id", "PATCH", (id) => `/vehicles/${id}`, { year: 2020 }],
    ["PUT /vehicles/:id/status", "PUT", (id) => `/vehicles/${id}/status`, { status: "maintenance" }],
    ["POST /vehicles/:id/retire", "POST", (id) => `/vehicles/${id}/retire`],
    ["GET /drivers/:id", "GET", (id) => `/drivers/${id}`],
    ["PATCH /drivers/:id", "PATCH", (id) => `/drivers/${id}`, { fullName: "Nobody Here" }],
    ["POST /drivers/:id/activate", "POST", (id) => `/drivers/${id}/activate`],
    ["POST /drivers/:id/deactivate", "POST", (id) => `/drivers/${id}/deactivate`],
    ["DELETE /drivers/:id/vehicle", "DELETE", (id) => `/drivers/${id}/vehicle`],
    ["POST /documents/:id/confirm", "POST", (id) => `/documents/${id}/confirm`],
    ["GET /documents/:id/download", "GET", (id) => `/documents/${id}/download`],
    ["DELETE /documents/:id", "DELETE", (id) => `/documents/${id}`],
  ];
  for (const [key, method, path, body] of idRoutes) {
    for (const [id, idLabel] of ids) {
      const long = idLabel === "5000chars";
      await s({ name: `${key} | id=${idLabel}`, method, path: path(id), body, expect: long ? [404, 414, 431, 400] : idLabel === "nul" ? [400, 404, 422] : 404, check: "a client error, never 5xx; 404 for an id that matches nothing (422 when the id itself is invalid input)",
        verify: (r) => (r.status >= 500 ? `server error ${r.status}: ${r.text.slice(0, 120)}` : true) });
    }
  }

  // ---------------------------------------------------------------- auth before validation
  const bad = { make: "", name: "", bodyType: "x", capacityKg: -1 };
  await s({ name: "order | anon + invalid body", actor: ctx.anon, method: "POST", path: "/vehicle-models", body: bad, expect: 401, check: "authentication is checked before validation", verify: problemCode("unauthenticated") });
  await s({ name: "order | anon + malformed json", actor: ctx.anon, method: "POST", path: "/vehicle-models", rawBody: "{bad", expect: [400, 401], note: "either order is defensible; recorded" });
  await s({ name: "order | nocompany + invalid body", actor: ctx.nocompany, method: "POST", path: "/vehicle-models", body: bad, expect: 403, check: "authorization is checked before validation", verify: problemCode("access-denied") });
  await s({ name: "order | dispatcher + invalid body", actor: ctx.dispatcher, method: "POST", path: "/vehicle-models", body: bad, expect: 403, verify: problemCode("access-denied") });
  await s({ name: "order | anon + oversized body", actor: ctx.anon, method: "POST", path: "/vehicle-models", rawBody: padded({ make: "x" }, MAX_BODY + 1), expect: [401, 413], note: "either order is defensible" });
  await s({ name: "order | dispatcher + not-found id + invalid body", actor: ctx.dispatcher, method: "PATCH", path: "/vehicle-models/does-not-exist", body: { capacityKg: -5 }, expect: 403, verify: problemCode("access-denied") });
  await s({ name: "order | owner + not-found id + invalid body", method: "PATCH", path: "/vehicle-models/does-not-exist", body: { capacityKg: -5 }, expect: 422, check: "validation precedes handler lookup" });

  // oversized body on the Better Auth raw route
  await s({ name: "auth sign-in | body over maxBodyBytes", actor: ctx.anon, method: "POST", path: "/api/auth/sign-in/email", rawBody: padded({ email: audit.email("x"), password: "y" }, MAX_BODY + 1), expect: 413, basis: "relkit-docs", note: "server.maxBodyBytes should apply to raw (Better Auth) routes too" });
  await s({ name: "auth sign-up | body 5 MiB", actor: ctx.anon, method: "POST", path: "/api/auth/sign-up/email", rawBody: padded({ name: "x", email: audit.email("big"), password: "correct-horse-battery" }, 5 * MAX_BODY), expect: 413, basis: "relkit-docs" });
}
