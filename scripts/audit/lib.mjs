// Shared plumbing for the logistics HTTP audit harness. Plain ES module, no dependencies:
// only global fetch and node built-ins, so it runs unchanged under node (>=22) and bun.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_BODY_RECORD = 4096;

export const sha = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const toArray = (value) => (Array.isArray(value) ? value : [value]);

/** Stable short summary of a cookie header: names kept, values replaced by a short hash. */
export function redactCookie(header) {
  if (!header) return header;
  return header
    .split(/;\s*/)
    .map((pair) => {
      const index = pair.indexOf("=");
      return index < 0 ? pair : `${pair.slice(0, index)}=<${sha(pair.slice(index + 1))}>`;
    })
    .join("; ");
}

/** Same for Set-Cookie: keep attributes, hash the value. */
export function redactSetCookie(raw) {
  const [first, ...attrs] = raw.split(/;\s*/);
  const index = first.indexOf("=");
  const redacted = index < 0 ? first : `${first.slice(0, index)}=<${sha(first.slice(index + 1))}>`;
  return [redacted, ...attrs].join("; ");
}

/** Masks the values of the query string of a (signed) URL while keeping parameter names. */
export function maskUrl(value) {
  if (typeof value !== "string") return value;
  return value.replace(/^(https?:\/\/[^?#]+)\?(.*)$/, (_m, base, query) =>
    `${base}?${query.split("&").map((p) => `${p.split("=")[0]}=<masked>`).join("&")}`,
  );
}

function redactBody(body) {
  if (body === null || typeof body !== "object") return body;
  const out = Array.isArray(body) ? [] : {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "token" && typeof value === "string") out[key] = `<token:${sha(value)}>`;
    else if ((key === "uploadUrl" || key === "url") && typeof value === "string") out[key] = maskUrl(value);
    else if (value !== null && typeof value === "object") out[key] = redactBody(value);
    else out[key] = value;
  }
  return out;
}

function clip(value) {
  // Returns {value, length, truncated} where value is JSON-able and at most MAX_BODY_RECORD chars when serialised.
  if (value === undefined) return { value: undefined, length: 0, truncated: false };
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const length = Buffer.byteLength(text);
  if (text.length <= MAX_BODY_RECORD) return { value, length, truncated: false };
  return { value: text.slice(0, MAX_BODY_RECORD), length, truncated: true };
}

export class Actor {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.email = undefined;
    this.userId = undefined;
    this.orgId = undefined;
  }
  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  ingest(setCookies) {
    if (this.name === "anon") return; // the anonymous actor must never accumulate cookies
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(/;\s*/);
      const index = pair.indexOf("=");
      if (index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const maxAge = attrs.find((a) => /^max-age=/i.test(a));
      if (value === "" || (maxAge && Number(maxAge.split("=")[1]) <= 0)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

function statusMatches(status, expected) {
  return toArray(expected).includes(status);
}
const fmtExpected = (expected) => toArray(expected).join("|");

export class Audit {
  constructor({ baseUrl, outDir, env, project, runId }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.outDir = outDir;
    this.env = env;
    this.project = project;
    this.runId = runId;
    this.startedAt = new Date().toISOString();
    this.rowsPath = join(outDir, "results.jsonl");
    this.summaryPath = join(outDir, "summary.json");
    this.ids = new Map();
    this.byGroup = {};
    this.total = 0;
    this.passed = 0;
    this.failed = 0;
    this.counter = 0;
    this.observed = []; // for contract conformance
    this.rows = [];
    this.currentGroup = undefined;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(this.rowsPath, "");
    this.flushSummary(true);
  }

  // ---- unique data -------------------------------------------------------------------------
  next() {
    this.counter += 1;
    return this.counter;
  }
  get tag() {
    return this.runId.toUpperCase();
  }
  email(label) {
    return `audit-${this.runId}-${label}@example.test`;
  }
  slug(label) {
    return `audit-${this.runId}-${label}`;
  }
  plate() {
    return `R${this.tag.slice(0, 5)} ${this.next()}`; // <= 16 chars
  }
  license() {
    return `LIC-${this.tag}-${this.next()}`;
  }
  vin() {
    const alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
    const bytes = randomBytes(17);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }
  modelName(prefix = "M") {
    return `${prefix}-${this.tag}-${this.next()}`;
  }

  // ---- summary -----------------------------------------------------------------------------
  flushSummary(running) {
    const summary = {
      env: this.env,
      baseUrl: this.baseUrl,
      runId: this.runId,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      running,
      total: this.total,
      passed: this.passed,
      failed: this.failed,
      currentGroup: this.currentGroup,
      byGroup: this.byGroup,
    };
    writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
  }

  record(row) {
    let id = row.id;
    const seen = this.ids.get(id) ?? 0;
    this.ids.set(id, seen + 1);
    if (seen > 0) id = `${id}#${seen + 1}`;
    row.id = id;
    appendFileSync(this.rowsPath, JSON.stringify(row) + "\n");
    this.rows.push(row);
    this.total += 1;
    row.pass ? (this.passed += 1) : (this.failed += 1);
    const g = (this.byGroup[row.group] ??= { total: 0, passed: 0, failed: 0 });
    g.total += 1;
    row.pass ? (g.passed += 1) : (g.failed += 1);
    if (this.total % 20 === 0) this.flushSummary(true);
    return row;
  }

  async group(name, fn) {
    this.currentGroup = name;
    this.byGroup[name] ??= { total: 0, passed: 0, failed: 0 };
    this.flushSummary(true);
    try {
      await fn();
    } catch (error) {
      this.record({
        id: `${name}:harness-exception`,
        group: name,
        name: "harness-exception",
        actor: "-",
        method: "-",
        path: "-",
        requestHeaders: {},
        expected: { status: "no exception" },
        basis: "http-norm",
        actual: { status: 0, headers: {}, body: String(error?.stack ?? error), durationMs: 0 },
        pass: false,
        note: "The harness itself threw inside this group; later rows of the group did not run.",
      });
    }
    this.flushSummary(true);
  }

  // ---- HTTP --------------------------------------------------------------------------------
  /** Raw request. Returns {status, headers, text, body, bytes, durationMs, requestHeaders, error?}. */
  async http({ method, path, actor, headers = {}, body, rawBody, redirect = "manual", absolute = false, timeoutMs = 30_000, origin = true }) {
    const url = absolute ? path : this.baseUrl + path;
    const h = {};
    if (origin) h.origin = this.baseUrl;
    if (actor && actor.cookieHeader) h.cookie = actor.cookieHeader;
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined) h["content-type"] = "application/json";
    for (const [k, v] of Object.entries(headers)) {
      if (v === null || v === undefined) delete h[k.toLowerCase()];
      else h[k.toLowerCase()] = v;
    }
    const requestHeaders = { ...h };
    if (requestHeaders.cookie) requestHeaders.cookie = redactCookie(requestHeaders.cookie);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method,
        headers: h,
        body: payload,
        redirect,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const buffer = new Uint8Array(await response.arrayBuffer());
      const durationMs = Math.round(performance.now() - started);
      const text = new TextDecoder().decode(buffer);
      const rh = {};
      for (const [k, v] of response.headers) if (k !== "set-cookie") rh[k] = v;
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length) rh["set-cookie"] = setCookies.map(redactSetCookie);
      if (actor) actor.ingest(setCookies);
      const contentType = rh["content-type"] ?? "";
      let parsed;
      if (/json/i.test(contentType) && text !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      return {
        status: response.status,
        headers: rh,
        text,
        body: parsed !== undefined ? parsed : text === "" ? null : text,
        json: parsed !== undefined,
        bytes: buffer,
        durationMs,
        requestHeaders,
        url,
        payloadLength: payload === undefined ? 0 : typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength,
      };
    } catch (error) {
      return {
        status: 0,
        headers: {},
        text: "",
        body: null,
        json: false,
        bytes: new Uint8Array(),
        durationMs: Math.round(performance.now() - started),
        requestHeaders,
        url,
        error: `${error?.name}: ${error?.message}${error?.cause ? ` (${error.cause.code ?? error.cause.message})` : ""}`,
        payloadLength: 0,
      };
    }
  }

  /**
   * One recorded request.
   * o: { group, name, actor, method, path, headers, body, rawBody, expect (status|[status]), check (string),
   *      verify(res) -> true | string, basis, note, fixture, absolute, redirect, recordBodyOf }
   */
  async step(o) {
    const res = await this.http(o);
    return this.finish(o, res);
  }

  /** Records a row for an already-performed request (used for polling and custom flows). */
  finish(o, res) {
    const expectedStatus = o.expect;
    const problems = [];
    let pass = statusMatches(res.status, expectedStatus);
    if (!pass) problems.push(`expected status ${fmtExpected(expectedStatus)}, got ${res.status}${res.error ? ` (${res.error})` : ""}`);
    if (o.verify) {
      try {
        const verdict = o.verify(res);
        if (verdict !== true && verdict !== undefined) {
          pass = false;
          problems.push(typeof verdict === "string" ? verdict : "verify() returned false");
        }
      } catch (error) {
        pass = false;
        problems.push(`verify() threw: ${error?.message}`);
      }
    }
    const requestId = res.headers["x-request-id"] ?? res.headers["x-trace-id"] ?? res.headers["request-id"] ?? (res.body && typeof res.body === "object" ? res.body.traceId ?? res.body.requestId : undefined);
    const bodyRecord = clip(res.json ? redactBody(res.body) : res.text.length > MAX_BODY_RECORD ? res.text : res.body);
    const reqBody = o.rawBody !== undefined ? clip(typeof o.rawBody === "string" ? o.rawBody : `<${o.rawBody.byteLength} bytes>`) : clip(o.body === undefined ? undefined : redactBody(o.body));
    const row = {
      id: `${o.group}:${o.name}`,
      group: o.group,
      name: o.name,
      actor: o.actor?.name ?? "anon",
      method: o.method,
      path: o.absolute ? maskUrl(o.path) : o.path,
      requestHeaders: res.requestHeaders,
      requestBody: reqBody.value,
      ...(reqBody.truncated || o.rawBody !== undefined ? { requestBodyLength: reqBody.length } : {}),
      expected: { status: expectedStatus, ...(o.check ? { check: o.check } : {}) },
      basis: o.basis ?? "app-contract",
      actual: {
        status: res.status,
        headers: res.headers,
        body: bodyRecord.value === undefined ? null : bodyRecord.value,
        bodyLength: res.bytes.byteLength,
        ...(bodyRecord.truncated ? { bodyTruncated: true } : {}),
        durationMs: res.durationMs,
        ...(res.error ? { error: res.error } : {}),
      },
      requestId: requestId ?? null,
      pass,
      ...(o.fixture ? { fixture: true } : {}),
    };
    const note = [o.note, ...problems].filter(Boolean).join(" | ");
    if (note) row.note = note;
    if (res.body && typeof res.body === "object" && res.body.traceId && res.headers["x-request-id"] && res.body.traceId !== res.headers["x-request-id"]) row.traceId = res.body.traceId;
    this.record(row);
    if (!o.absolute) {
      this.observed.push({
        rowId: row.id,
        actor: row.actor,
        hasRequestIdHeader: Boolean(res.headers["x-request-id"]),
        requestIdHeader: res.headers["x-request-id"],
        durationMs: res.durationMs,
        method: o.method,
        pathname: new URL(res.url).pathname,
        status: res.status,
        contentType: res.headers["content-type"] ?? "",
        body: res.json && res.bytes.byteLength < 200_000 ? res.body : undefined,
      });
    }
    res.row = row;
    return res;
  }
}

// ---- verification helpers -----------------------------------------------------------------

export const problemCode = (code) => (res) => {
  if (!res.json || res.body === null || typeof res.body !== "object") return `body is not a JSON object (content-type ${res.headers["content-type"]})`;
  return res.body.code === code ? true : `expected code ${code}, got ${res.body.code}`;
};

export const all = (...checks) => (res) => {
  for (const check of checks) {
    const verdict = check(res);
    if (verdict !== true && verdict !== undefined) return verdict;
  }
  return true;
};

export const hasKeys = (...keys) => (res) => {
  if (res.body === null || typeof res.body !== "object") return "body is not an object";
  const missing = keys.filter((k) => !(k in res.body));
  return missing.length ? `missing keys: ${missing.join(",")}` : true;
};

export const bodyMatches = (partial) => (res) => {
  if (res.body === null || typeof res.body !== "object") return "body is not an object";
  for (const [k, v] of Object.entries(partial)) {
    const actual = res.body[k];
    if (JSON.stringify(actual) !== JSON.stringify(v)) return `body.${k} = ${JSON.stringify(actual)}, expected ${JSON.stringify(v)}`;
  }
  return true;
};

export const isProblemJson = (res) => (/application\/problem\+json/i.test(res.headers["content-type"] ?? "") ? true : `content-type is ${res.headers["content-type"] ?? "(none)"}, not application/problem+json`);
