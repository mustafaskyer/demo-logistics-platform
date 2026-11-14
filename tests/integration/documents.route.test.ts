import { beforeAll, describe, expect, test } from "bun:test";
import {
  addMember,
  registerCompany,
  sampleDriver,
  sampleModel,
  sampleVehicle,
  startHarness,
  type Harness,
  type TestUser,
} from "../support/harness.js";

let harness: Harness;
let owner: TestUser;
let admin: TestUser;
let dispatcher: TestUser;
let rival: TestUser;
let driverId: string;
let vehicleId: string;

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`);

const request = (user: TestUser, overrides: Record<string, unknown> = {}, bytes = pdf("hello")) =>
  user.post("/documents", {
    ownerType: "driver",
    ownerId: driverId,
    kind: "license",
    filename: "licence front.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    ...overrides,
  });

const upload = (url: string, bytes: Uint8Array, contentType = "application/pdf") =>
  fetch(url, { method: "PUT", headers: { "content-type": contentType }, body: bytes });

beforeAll(async () => {
  harness = await startHarness();
  owner = await registerCompany(harness, "Docco");
  admin = await addMember(harness, owner, "Docadmin", "admin");
  dispatcher = await addMember(harness, owner, "Docdispatcher", "dispatcher");
  rival = await registerCompany(harness, "Docrival");
  driverId = (await owner.post("/drivers", sampleDriver({ licenseNumber: "DOC-1" }))).body.id;
  const modelId = (await owner.post("/vehicle-models", sampleModel({ name: "Docs-Base" }))).body.id;
  vehicleId = (await owner.post("/vehicles", sampleVehicle(modelId, { plate: "DOC 1" }))).body.id;
}, 180_000);

describe("document lifecycle", () => {
  test("request, upload to the signed URL, confirm, list, download and delete", async () => {
    const bytes = pdf("full lifecycle");
    const requested = await request(owner, {}, bytes);
    expect(requested.status).toBe(201);
    expect(requested.body.document).toMatchObject({ status: "pending", ownerType: "driver", ownerId: driverId, kind: "license" });
    expect(requested.body.document.objectKey).toBeUndefined();
    expect(requested.body.document.organizationId).toBeUndefined();

    // Not listed or downloadable until the upload is confirmed.
    expect((await owner.get(`/documents?ownerType=driver&ownerId=${driverId}`)).body.items.map((d: { id: string }) => d.id)).not.toContain(requested.body.document.id);
    const early = await owner.get(`/documents/${requested.body.document.id}/download`);
    expect([early.status, early.body.code]).toEqual([409, "documents.document-not-ready"]);

    expect((await upload(requested.body.uploadUrl, bytes)).ok).toBe(true);
    const confirmed = await owner.post(`/documents/${requested.body.document.id}/confirm`);
    expect([confirmed.status, confirmed.body.status]).toEqual([200, "uploaded"]);
    // Confirming twice is harmless.
    expect((await owner.post(`/documents/${requested.body.document.id}/confirm`)).body.status).toBe("uploaded");

    const listed = await owner.get(`/documents?ownerType=driver&ownerId=${driverId}`);
    expect(listed.body.items.map((d: { id: string }) => d.id)).toContain(requested.body.document.id);

    const download = await dispatcher.get(`/documents/${requested.body.document.id}/download`);
    expect(download.status).toBe(200);
    expect(download.body).toMatchObject({ filename: "licence front.pdf", contentType: "application/pdf" });
    const fetched = new Uint8Array(await (await fetch(download.body.url)).arrayBuffer());
    expect(new TextDecoder().decode(fetched)).toBe("%PDF-1.4 full lifecycle");

    expect((await admin.delete(`/documents/${requested.body.document.id}`)).status).toBe(200);
    expect((await owner.get(`/documents/${requested.body.document.id}/download`)).status).toBe(404);
    expect((await fetch(download.body.url)).ok).toBe(false);
  });

  test("vehicles can have documents too", async () => {
    const bytes = pdf("insurance");
    const requested = await request(owner, { ownerType: "vehicle", ownerId: vehicleId, kind: "insurance" }, bytes);
    expect(requested.status).toBe(201);
    await upload(requested.body.uploadUrl, bytes);
    await owner.post(`/documents/${requested.body.document.id}/confirm`);
    const listed = await owner.get(`/documents?ownerType=vehicle&ownerId=${vehicleId}`);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].kind).toBe("insurance");
  });

  test("confirming without an upload fails and leaves the document pending", async () => {
    const requested = await request(owner);
    const result = await owner.post(`/documents/${requested.body.document.id}/confirm`);
    expect([result.status, result.body.code]).toEqual([409, "documents.upload-missing"]);
  });

  test("a file whose size differs from the declaration is discarded", async () => {
    const requested = await request(owner, { sizeBytes: 10 });
    await upload(requested.body.uploadUrl, pdf("this is much longer than ten bytes"));
    const result = await owner.post(`/documents/${requested.body.document.id}/confirm`);
    expect([result.status, result.body.code]).toEqual([422, "documents.upload-size-mismatch"]);
    expect((await owner.post(`/documents/${requested.body.document.id}/confirm`)).status).toBe(404);
  });
});

describe("validation", () => {
  test("only allowed content types and sizes are accepted", async () => {
    expect((await request(owner, { contentType: "application/x-msdownload", filename: "evil.exe" })).status).toBe(422);
    expect((await request(owner, { sizeBytes: 5_000_001 })).status).toBe(422);
    expect((await request(owner, { sizeBytes: 0 })).status).toBe(422);
    expect((await request(owner, { kind: "selfie" })).status).toBe(422);
    expect((await request(owner, { ownerType: "company" })).status).toBe(422);
  });

  test("the owner must exist in the caller's company", async () => {
    const ghost = await request(owner, { ownerId: "ghost" });
    expect([ghost.status, ghost.body.code]).toEqual([404, "documents.owner-not-found"]);
    const foreign = await request(rival);
    expect([foreign.status, foreign.body.code]).toEqual([404, "documents.owner-not-found"]);
    const foreignVehicle = await request(rival, { ownerType: "vehicle", ownerId: vehicleId });
    expect([foreignVehicle.status, foreignVehicle.body.code]).toEqual([404, "documents.owner-not-found"]);
  });

  test("hostile filenames cannot escape the company's key prefix", async () => {
    const requested = await request(owner, { filename: "../../other-company/secret.pdf" });
    expect(requested.status).toBe(201);
    expect(new URL(requested.body.uploadUrl).pathname).not.toContain("..");
  });
});

describe("access control and isolation", () => {
  test("only owners and admins upload; dispatchers read", async () => {
    expect((await request(admin)).status).toBe(201);
    expect((await request(dispatcher)).status).toBe(403);
    expect((await dispatcher.get(`/documents?ownerType=driver&ownerId=${driverId}`)).status).toBe(200);
    const bytes = pdf("role check");
    const requested = await request(owner, {}, bytes);
    await upload(requested.body.uploadUrl, bytes);
    await owner.post(`/documents/${requested.body.document.id}/confirm`);
    expect((await dispatcher.delete(`/documents/${requested.body.document.id}`)).status).toBe(403);
  });

  test("another company cannot list, download, confirm or delete documents", async () => {
    const bytes = pdf("private");
    const requested = await request(owner, {}, bytes);
    await upload(requested.body.uploadUrl, bytes);
    await owner.post(`/documents/${requested.body.document.id}/confirm`);
    const id = requested.body.document.id;

    expect((await rival.get(`/documents/${id}/download`)).status).toBe(404);
    expect((await rival.post(`/documents/${id}/confirm`)).status).toBe(404);
    expect((await rival.delete(`/documents/${id}`)).status).toBe(404);
    expect((await rival.get(`/documents?ownerType=driver&ownerId=${driverId}`)).body.items).toEqual([]);
    expect((await owner.get(`/documents/${id}/download`)).status).toBe(200);
  });

  test("anonymous callers are rejected", async () => {
    const anonymous = await fetch(`${harness.baseUrl}/documents?ownerType=driver&ownerId=${driverId}`);
    expect(anonymous.status).toBe(401);
  });
});
