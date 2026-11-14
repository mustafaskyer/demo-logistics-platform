import { beforeAll, describe, expect, test } from "bun:test";
import { createClient } from "@relkit/client";
import { addMember, registerCompany, sampleModel, signUp, sampleVehicle, startHarness, type Harness, type TestUser } from "../support/harness.js";

let harness: Harness;
let owner: TestUser;
let dispatcher: TestUser;
let rival: TestUser;
let companyId: string;
let vehicleId: string;

/** Mirrors the browser client: fetch the identity for this session, then send it with every call. */
async function clientFor(user: TestUser) {
  const headers: Record<string, string> = { origin: harness.baseUrl };
  if (user.cookieHeader !== "") headers.cookie = user.cookieHeader;
  const identity = (await (await fetch(`${harness.baseUrl}/_relkit/v1/client/identity`, { headers })).json()) as {
    identityScope: string;
    sessionEpoch: string;
  };
  return createClient({
    baseUrl: harness.baseUrl,
    headers: { ...headers, "x-relkit-identity-scope": identity.identityScope, "x-relkit-session-epoch": identity.sessionEpoch },
  }) as any;
}

/** Opens the channel, then resolves with the first frame matching `wanted` (or rejects on timeout/denial). */
async function firstFrame(user: TestUser, id: string, wanted: (frame: any) => boolean, trigger?: () => Promise<unknown>) {
  const controller = new AbortController();
  const stream = await (await clientFor(user))["relkit.realtime.subscribe"](
    { channel: "fleet.vehicle-status", params: { companyId: id } },
    { signal: controller.signal },
  );
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    if (trigger !== undefined) setTimeout(() => void trigger(), 400);
    for await (const frame of stream) {
      if (wanted(frame)) return frame;
    }
    throw new Error("stream ended without the expected frame");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

beforeAll(async () => {
  harness = await startHarness();
  owner = await registerCompany(harness, "Liveco");
  dispatcher = await addMember(harness, owner, "Livedispatcher", "dispatcher");
  rival = await registerCompany(harness, "Liverival");
  companyId = (await owner.get("/api/auth/get-session")).body.session.activeOrganizationId;
  const modelId = (await owner.post("/vehicle-models", sampleModel({ name: "Live-Base" }))).body.id;
  vehicleId = (await owner.post("/vehicles", sampleVehicle(modelId, { plate: "LIVE 1" }))).body.id;
}, 180_000);

describe("fleet.vehicle-status channel", () => {
  test("members receive status changes for their company", async () => {
    const frame = await firstFrame(
      dispatcher,
      companyId,
      (f) => JSON.stringify(f).includes(vehicleId),
      () => dispatcher.put(`/vehicles/${vehicleId}/status`, { status: "maintenance" }),
    );
    expect(frame).toMatchObject({
      kind: "event",
      event: "changed",
      payload: { vehicleId, from: "active", to: "maintenance" },
    });
  });

  test("another company cannot subscribe to this company's channel", async () => {
    await expect(firstFrame(rival, companyId, () => true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a signed-in user without a company cannot subscribe", async () => {
    const loner = await signUp(harness, "Live Loner", "live-loner@example.com");
    await expect(firstFrame(loner, companyId, () => true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
