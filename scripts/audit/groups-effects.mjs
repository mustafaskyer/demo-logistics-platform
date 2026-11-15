// Group "effects": event reactions and the realtime channel fleet.vehicle-status.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { Actor, problemCode, redactCookie, sleep } from "./lib.mjs";

const CHANNEL = "fleet.vehicle-status";

async function loadClient(project) {
  if (!project) return { error: "no --project given, cannot locate @relkit/client" };
  const entry = join(project, "node_modules", "@relkit", "client", "dist", "index.js");
  if (!existsSync(entry)) return { error: `${entry} does not exist` };
  try {
    return { mod: await import(pathToFileURL(entry).href) };
  } catch (error) {
    return { error: `import of @relkit/client failed: ${error?.message}` };
  }
}

export async function effectsGroup(audit, ctx, fx) {
  const G = "effects";
  const owner = ctx.owner;
  const s = (o) => audit.step({ group: G, actor: owner, ...o });

  const model = await fx.model();

  // ------------------------------------------------------------------ event reaction
  async function reaction(name, change) {
    const driver = await fx.driver();
    const vehicle = await fx.vehicle(model?.id);
    const bystanderDriver = await fx.driver();
    const bystanderVehicle = await fx.vehicle(model?.id);
    await fx.assign(driver?.id, vehicle?.id);
    await fx.assign(bystanderDriver?.id, bystanderVehicle?.id);
    const trigger = await s({ name: `${name} | trigger`, ...change(vehicle?.id), fixture: false });
    const t0 = performance.now();
    let polls = 0;
    let res;
    let released = false;
    do {
      await sleep(polls === 0 ? 0 : 100);
      polls += 1;
      res = await audit.http({ actor: owner, method: "GET", path: "/driver-assignments" });
      released = res.status === 200 && !res.body.items.some((a) => a.vehicleId === vehicle?.id);
    } while (!released && performance.now() - t0 < 10_000);
    const ms = Math.round(performance.now() - t0);
    audit.finish({
      group: G, name: `${name} | assignment closed`, actor: owner, method: "GET", path: "/driver-assignments",
      expect: 200, basis: "app-contract",
      check: "the open assignment of the vehicle disappears within 10 s (event reaction drivers.release-unavailable-vehicle); the bystander assignment stays",
      note: `trigger status ${trigger.status}; released=${released} after ${ms} ms and ${polls} poll(s) counted from the trigger response`,
      verify: (r) => (!released ? `assignment still open after ${ms} ms` : r.body.items.some((a) => a.vehicleId === bystanderVehicle?.id) ? true : "bystander assignment was released too"),
    }, res);
    const hist = await s({ name: `${name} | history keeps closed assignment`, method: "GET", path: "/driver-assignments?includeClosed=true", expect: 200,
      verify: (r) => (r.body.items.some((a) => a.vehicleId === vehicle?.id && a.unassignedAt) ? true : "closed assignment not in history with unassignedAt set") });
    void hist;
    return { ms, released, vehicle };
  }
  const r1 = await reaction("reaction maintenance", (id) => ({ method: "PUT", path: `/vehicles/${id}/status`, body: { status: "maintenance" }, expect: 200 }));
  const r2 = await reaction("reaction retire", (id) => ({ method: "POST", path: `/vehicles/${id}/retire`, expect: 200 }));
  // active again must not open anything and must not release
  const v3 = await fx.vehicle(model?.id);
  const d3 = await fx.driver();
  await fx.assign(d3?.id, v3?.id);
  await s({ name: "reaction no-op | assigned vehicle patched (plate) keeps assignment", method: "PATCH", path: `/vehicles/${v3?.id}`, body: { year: 2024 }, expect: 200 });
  await sleep(1500);
  await s({ name: "reaction no-op | assignment still open after unrelated update", method: "GET", path: "/driver-assignments", expect: 200, verify: (r) => (r.body.items.some((a) => a.vehicleId === v3?.id) ? true : "assignment disappeared without a status change") });
  void r1; void r2;

  // ------------------------------------------------------------------ realtime
  const loaded = await loadClient(audit.project);
  if (loaded.error) {
    audit.record({ id: `${G}:realtime-client-unavailable`, group: G, name: "realtime-client-unavailable", actor: "-", method: "-", path: "-", requestHeaders: {}, expected: { status: "client loadable" }, basis: "app-contract",
      actual: { status: 0, headers: {}, body: loaded.error, durationMs: 0 }, pass: false, note: `Realtime cannot be driven from this script: ${loaded.error}` });
    return;
  }
  const { createClient } = loaded.mod;

  const identityOf = async (actor, name) => {
    const res = await audit.step({ group: G, name, actor, method: "GET", path: "/_relkit/v1/client/identity", expect: 200, basis: "relkit-docs", check: "identityScope and sessionEpoch for the client headers",
      verify: (r) => (r.body?.identityScope && r.body?.sessionEpoch ? true : "identity fields missing") });
    return res.body;
  };

  /**
   * Opens the channel and collects frames. opts: { after, until(frames), onCaughtUp(), maxMs }.
   * Returns { frames, error, httpStatus, rpcUrl, durationMs, endedAfterAbort, endedMs, started, requestHeaders }.
   */
  async function subscribe(actor, params, opts = {}) {
    const identity = await identityOf(actor, `rt identity | ${actor.name} (${opts.label ?? "subscribe"})`);
    const headers = { origin: audit.baseUrl };
    if (actor.cookieHeader) headers.cookie = actor.cookieHeader;
    const capture = { status: undefined, url: undefined, headers: {} };
    const client = createClient({
      baseUrl: audit.baseUrl,
      headers: { ...headers, ...(identity ? { "x-relkit-identity-scope": identity.identityScope, "x-relkit-session-epoch": identity.sessionEpoch } : {}) },
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        capture.status = response.status;
        capture.url = String(url);
        for (const [k, v] of response.headers) if (k !== "set-cookie") capture.headers[k] = v;
        return response;
      },
    });
    const controller = new AbortController();
    const frames = [];
    const started = performance.now();
    let error;
    const input = { channel: opts.channel ?? CHANNEL, params, ...(opts.after ? { after: opts.after } : {}) };
    const work = (async () => {
      try {
        const stream = await client["relkit.realtime.subscribe"](input, { signal: controller.signal });
        for await (const frame of stream) {
          frames.push({ ...frame, _at: performance.now() - started, _abs: performance.now() });
          if (frame.kind === "caught-up" && opts.onCaughtUp && !opts._fired) {
            opts._fired = true;
            await opts.onCaughtUp(frame);
          }
          if (opts.until?.(frames)) break;
        }
      } catch (e) {
        if (!controller.signal.aborted) error = { code: e?.code, message: String(e?.message ?? e).slice(0, 300), status: e?.status ?? e?.data?.status };
      }
    })();
    const timer = new Promise((resolve) => setTimeout(resolve, opts.maxMs ?? 6000, "timeout"));
    await Promise.race([work, timer]);
    const durationMs = Math.round(performance.now() - started);
    const abortAt = performance.now();
    controller.abort();
    const endedAfterAbort = await Promise.race([work.then(() => true), sleep(3000).then(() => false)]);
    const endedMs = Math.round(performance.now() - abortAt);
    return { frames, error, httpStatus: capture.status, rpcUrl: capture.url, rpcHeaders: capture.headers, durationMs, endedAfterAbort, endedMs, input, actor };
  }

  const summarise = (frames) => frames.map((f) => ({ kind: f.kind, ...(f.event ? { event: f.event } : {}), ...(f.payload ? { payload: f.payload } : {}), ...(f.checkpoint ? { sequence: f.checkpoint.sequence, historyStart: f.checkpoint.historyStart } : {}), atMs: Math.round(f._at) }));

  function rtRow(name, result, { expect, check, basis = "app-contract", note, verify }) {
    const frames = summarise(result.frames);
    const problems = [];
    let pass = true;
    try {
      const verdict = verify(result);
      if (verdict !== true) { pass = false; problems.push(verdict); }
    } catch (e) {
      pass = false; problems.push(`verify threw: ${e.message}`);
    }
    const rpcPath = result.rpcUrl ? new URL(result.rpcUrl).pathname : "/_relkit/v1/rpc";
    const row = {
      id: `${G}:${name}`, group: G, name, actor: result.actor.name, method: "POST", path: `${rpcPath} (relkit.realtime.subscribe)`,
      requestHeaders: { origin: audit.baseUrl, ...(result.actor.cookieHeader ? { cookie: redactCookie(result.actor.cookieHeader) } : {}), "x-relkit-identity-scope": "<from /_relkit/v1/client/identity>" },
      requestBody: { ...result.input, ...(result.input.after ? { after: { sequence: result.input.after.sequence, historyStart: result.input.after.historyStart, "...": "checkpoint" } } : {}) },
      expected: { status: expect, check }, basis,
      actual: { status: result.httpStatus ?? 0, headers: result.rpcHeaders ?? {}, body: { frames, error: result.error ?? null, endedAfterAbort: result.endedAfterAbort, endedMs: result.endedMs }, durationMs: result.durationMs },
      requestId: result.rpcHeaders?.["x-request-id"] ?? null,
      pass, ...(note || problems.length ? { note: [note, ...problems].filter(Boolean).join(" | ") } : {}),
    };
    audit.record(row);
    return row;
  }

  const companyId = ctx.orgA;
  const eventFrames = (result) => result.frames.filter((f) => f.kind === "event");

  // 1 members of the company receive changes
  for (const [label, actor] of [["dispatcher", ctx.dispatcher], ["member", ctx.member], ["driver", ctx.driver], ["owner", owner]]) {
    const vehicle = await fx.vehicle(model?.id);
    let triggerRes;
    let triggeredAt;
    const result = await subscribe(actor, { companyId }, {
      label: "receives change",
      until: (frames) => frames.some((f) => f.kind === "event" && f.payload?.vehicleId === vehicle?.id),
      onCaughtUp: async () => {
        triggeredAt = performance.now();
        triggerRes = await audit.step({ group: G, name: `rt trigger | ${label} receives`, actor: ctx.dispatcher, method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "maintenance" }, expect: 200 });
      },
    });
    const ev = eventFrames(result).find((f) => f.payload?.vehicleId === vehicle?.id);
    rtRow(`rt subscribe | ${label} receives changed`, result, {
      expect: "200 stream; frame {kind:event,event:changed,payload:{vehicleId,from:active,to:maintenance,at}}", check: "subscribed member gets the event after caught-up",
      verify: (r) => {
        if (r.error) return `subscribe failed: ${JSON.stringify(r.error)}`;
        if (!ev) return "no changed event within 6 s";
        const p = ev.payload;
        if (ev.event !== "changed" || p.from !== "active" || p.to !== "maintenance" || typeof p.at !== "string") return `unexpected frame ${JSON.stringify(ev)}`;
        const keys = Object.keys(p).sort().join(",");
        return keys === "at,from,to,vehicleId" ? true : `payload keys ${keys}`;
      },
      note: ev && triggeredAt ? `PUT status answered ${triggerRes?.status}; event frame arrived ${Math.round(ev._abs - triggeredAt)} ms after the PUT was sent` : undefined,
    });
    if (label === "dispatcher") ctx.rtFirstCheckpoint = ev?.checkpoint;
  }

  // 2 denial cases
  const denial = async (name, actor, params, extra = {}) => {
    const result = await subscribe(actor, params, { label: name, maxMs: 4000, ...extra });
    rtRow(`rt deny | ${name}`, result, {
      expect: "rejected before any event frame (client error NOT_FOUND per tests/integration/realtime.test.ts)", check: "no frames, error", basis: "app-contract",
      verify: (r) => (r.frames.some((f) => f.kind === "event") ? "an event frame was delivered to a denied caller" : r.error ? (r.error.code === "NOT_FOUND" ? true : `rejected with ${JSON.stringify(r.error)} (tests assert NOT_FOUND)`) : r.frames.length ? `stream opened and sent ${r.frames.map((f) => f.kind).join(",")} instead of rejecting` : "stream stayed silent instead of rejecting"),
    });
    return result;
  };
  await denial("other company owner subscribes to company A", ctx.ownerB, { companyId });
  await denial("signed-in user without company", ctx.nocompany, { companyId });
  await denial("member of A asks for company B's id", ctx.member, { companyId: ctx.orgB });
  await denial("owner asks for an unknown company id", owner, { companyId: "does-not-exist" });
  await denial("no session at all (anonymous visitor with its own identity cookies)", new Actor("visitor"), { companyId });
  for (const [label, params] of [["empty companyId", { companyId: "" }], ["missing params", {}], ["companyId wrong type", { companyId: 5 }]]) {
    const r = await subscribe(owner, params, { label, maxMs: 4000 });
    rtRow(`rt deny | ${label}`, r, { expect: "rejected with a client error (BAD_REQUEST or NOT_FOUND)", check: "channel params are validated; no frames", basis: "relkit-docs",
      verify: (x) => (x.frames.some((f) => f.kind === "event") ? "event delivered" : x.error && ["BAD_REQUEST", "NOT_FOUND"].includes(x.error.code) ? true : `result: ${JSON.stringify(x.error)} frames ${x.frames.map((f) => f.kind)}`) });
  }
  {
    // identity precondition: stale identity headers must be a client error, not a server error
    const headers = { origin: audit.baseUrl, cookie: owner.cookieHeader, "x-relkit-identity-scope": "sha256:stale", "x-relkit-session-epoch": "sha256:stale" };
    const capture = {};
    const client = createClient({ baseUrl: audit.baseUrl, headers, fetch: async (u, i) => { const r = await fetch(u, i); capture.status = r.status; return r; } });
    let error;
    const controller = new AbortController();
    try {
      const stream = await client["relkit.realtime.subscribe"]({ channel: CHANNEL, params: { companyId } }, { signal: controller.signal });
      for await (const f of stream) { void f; break; }
    } catch (e) { error = { code: e?.code, status: e?.status, message: String(e?.message).slice(0, 200) }; }
    controller.abort();
    const row = { id: `${G}:rt identity | stale identity headers`, group: G, name: "rt identity | stale identity headers", actor: "owner", method: "POST", path: "/_relkit/v1/rpc (relkit.realtime.subscribe)", requestHeaders: { cookie: redactCookie(owner.cookieHeader), "x-relkit-identity-scope": "sha256:stale" }, requestBody: { channel: CHANNEL, params: { companyId } },
      expected: { status: "4xx", check: "a stale/forged client identity is rejected with a client error (409/412/403), not 500" }, basis: "http-norm",
      actual: { status: capture.status ?? 0, headers: {}, body: { error }, durationMs: 0 }, requestId: null, pass: Boolean(error) && !(error.status >= 500) && (error.status ?? 0) >= 400, note: error ? `client error ${JSON.stringify(error)}` : "no error: the stream opened with forged identity headers" };
    audit.record(row);
  }
  const unknownChannel = await subscribe(owner, { companyId }, { channel: "fleet.does-not-exist", maxMs: 4000, label: "unknown channel" });
  rtRow("rt deny | unknown channel id", unknownChannel, { expect: "rejected", check: "error, no frames", verify: (r) => (r.error ? true : `no error; frames ${r.frames.map((f) => f.kind).join(",")}`) });

  // a removed member loses the live feed (the channel re-checks the member row)
  // (covered in auth group for HTTP; the removed user's session still names the company)

  // 3 replay
  {
    const first = await subscribe(owner, { companyId }, { label: "baseline checkpoint", until: (f) => f.some((x) => x.kind === "caught-up"), maxMs: 4000 });
    const cp = first.frames.find((f) => f.kind === "caught-up")?.checkpoint;
    rtRow("rt replay | baseline caught-up checkpoint", first, { expect: "caught-up frame with a checkpoint", check: "fresh subscription ends replay with caught-up", basis: "relkit-docs", verify: (r) => (cp ? true : `no caught-up (error ${JSON.stringify(r.error)})`) });
    const vehicle = await fx.vehicle(model?.id);
    await s({ name: "rt replay | change 1 (maintenance)", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "maintenance" }, expect: 200 });
    await s({ name: "rt replay | change 2 (active)", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "active" }, expect: 200 });
    await s({ name: "rt replay | change 3 (retire)", method: "POST", path: `/vehicles/${vehicle?.id}/retire`, expect: 200 });
    const replay = await subscribe(owner, { companyId }, { label: "replay after checkpoint", after: cp, until: (f) => f.filter((x) => x.kind === "event").length >= 3 && f.some((x) => x.kind === "caught-up"), maxMs: 6000 });
    rtRow("rt replay | after checkpoint delivers the 3 missed events in order", replay, {
      expect: "events maintenance, active, retired for the vehicle, then caught-up", check: "replay.retentionMs=300000 maxEvents=500 on the channel", basis: "app-contract",
      verify: (r) => {
        if (r.error) return `subscribe failed: ${JSON.stringify(r.error)}`;
        const mine = eventFrames(r).filter((f) => f.payload?.vehicleId === vehicle?.id).map((f) => `${f.payload.from}>${f.payload.to}`);
        const want = "active>maintenance,maintenance>active,active>retired";
        const seqs = eventFrames(r).map((f) => Number(f.checkpoint?.sequence));
        const ordered = seqs.every((n, i) => i === 0 || n > seqs[i - 1]);
        return mine.join(",") === want && ordered ? true : `got ${mine.join(",") || "(none)"}; sequences ${seqs.join(",")}`;
      },
    });
    const fresh = await subscribe(owner, { companyId }, { label: "fresh no cursor", until: (f) => f.some((x) => x.kind === "caught-up"), maxMs: 4000 });
    rtRow("rt replay | subscription without cursor sends no history", fresh, {
      expect: "caught-up only (realtime-apis.md: load authoritative state through a route first; replay needs the checkpoint)", basis: "relkit-docs", check: "no event frames before caught-up",
      verify: (r) => (eventFrames(r).length === 0 && r.frames.some((f) => f.kind === "caught-up") ? true : `frames: ${r.frames.map((f) => f.kind).join(",")}`),
    });
    const garbage = await subscribe(owner, { companyId }, { label: "garbage cursor", after: { x: 1 }, until: (f) => f.some((x) => x.kind === "caught-up"), maxMs: 4000 });
    rtRow("rt replay | garbage cursor yields gap", garbage, {
      expect: "gap frame then caught-up (client must refetch state)", basis: "relkit-docs", check: "onGap semantics from realtime-apis.md",
      verify: (r) => (r.frames.some((f) => f.kind === "gap") ? true : `frames: ${r.frames.map((f) => f.kind).join(",")}; error ${JSON.stringify(r.error)}`),
    });
    const crossCp = await subscribe(ctx.ownerB, { companyId: ctx.orgB }, { label: "company A cursor on company B channel", after: cp, until: (f) => f.some((x) => x.kind === "caught-up"), maxMs: 4000 });
    rtRow("rt replay | company A cursor used on company B's channel leaks nothing", crossCp, {
      expect: "gap or error, never company A events", basis: "app-contract", check: "tenant isolation of replay",
      verify: (r) => (eventFrames(r).some((f) => f.payload?.vehicleId === vehicle?.id) ? "company A event delivered to company B" : true),
    });
    const crossActor = await subscribe(ctx.ownerB, { companyId }, { label: "company B replays company A cursor on A's channel", after: cp, maxMs: 4000 });
    rtRow("rt replay | company B cannot replay company A's channel with A's cursor", crossActor, {
      expect: "rejected", basis: "app-contract", check: "authorize() runs before replay",
      verify: (r) => (eventFrames(r).length ? "events delivered" : r.error ? true : "no error and no events"),
    });
    const expired = await subscribe(owner, { companyId }, { label: "stale checkpoint (sequence 0)", after: cp ? { ...cp, sequence: "0", historyStart: "1" } : { x: 1 }, until: (f) => f.some((x) => x.kind === "caught-up"), maxMs: 4000 });
    rtRow("rt replay | forged checkpoint sequence", expired, {
      expect: "gap, error or a replay that does not leak other tenants (checkpoint is server-issued)", basis: "http-norm", check: "forged cursor handled", note: "frames recorded for inspection",
      verify: (r) => (eventFrames(r).some((f) => f.payload && !f.payload.vehicleId) ? "malformed events" : true),
    });
  }

  // 4 abort behaviour after replay + live event (observed in manual probing: the iteration did not end)
  for (let i = 1; i <= 3; i += 1) {
    const base = await subscribe(owner, { companyId }, { label: "abort probe cursor", until: (f) => f.some((x) => x.kind === "caught-up"), maxMs: 4000 });
    const cp = base.frames.find((f) => f.kind === "caught-up")?.checkpoint;
    const vehicle = await fx.vehicle(model?.id);
    await s({ name: `rt abort probe ${i} | pre-change`, method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "maintenance" }, expect: 200 });
    let live = false;
    const r = await subscribe(owner, { companyId }, {
      label: `abort probe ${i}`, after: cp, maxMs: 3500,
      onCaughtUp: async () => {
        if (live) return;
        live = true;
        await audit.step({ group: G, name: `rt abort probe ${i} | live change`, actor: owner, method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "active" }, expect: 200 });
      },
    });
    rtRow(`rt abort probe ${i} | iteration ends when the caller aborts after replay + live event`, r, {
      expect: "iteration ends within 1 s of AbortController.abort()", basis: "relkit-docs", check: "for await over the subscription stream must finish once its signal aborts",
      note: `endedAfterAbort=${r.endedAfterAbort} after ${r.endedMs} ms (waited at most 3000 ms); events seen: ${eventFrames(r).length}`,
      verify: (res) => (res.endedAfterAbort && res.endedMs <= 1000 ? true : `iteration still pending ${res.endedMs} ms after abort (endedAfterAbort=${res.endedAfterAbort})`),
    });
  }

  // 5 rpc endpoint behaviour with no body
  await s({ name: "rt rpc | GET /_relkit/v1/rpc without session", actor: ctx.anon, method: "GET", path: "/_relkit/v1/rpc", expect: [400, 404, 405, 415], basis: "http-norm", check: "not 5xx", verify: (r) => (r.status >= 500 ? `status ${r.status}` : true) });
}
