import { beforeAll, describe, expect, test } from "bun:test";
import { addMember, registerCompany, sampleModel, sampleVehicle, startHarness, type Harness, type TestUser } from "../support/harness.js";

let harness: Harness;
let owner: TestUser;
let admin: TestUser;
let dispatcher: TestUser;
let rival: TestUser;

const createModel = async (user: TestUser, overrides: Record<string, unknown> = {}) => (await user.post("/vehicle-models", sampleModel(overrides))).body;

beforeAll(async () => {
  harness = await startHarness();
  owner = await registerCompany(harness, "Fleetco");
  admin = await addMember(harness, owner, "Fleetadmin", "admin");
  dispatcher = await addMember(harness, owner, "Fleetdispatcher", "dispatcher");
  rival = await registerCompany(harness, "Fleetrival");
}, 120_000);

describe("vehicle models", () => {
  test("create returns 201 and a public shape without the tenant id", async () => {
    const result = await owner.post("/vehicle-models", sampleModel({ name: "Create-Shape" }));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ make: "Isuzu", name: "Create-Shape", bodyType: "box_truck", capacityKg: 3500 });
    expect(result.body.organizationId).toBeUndefined();
  });

  test("validation rejects bad input with 422 and issue paths", async () => {
    const result = await owner.post("/vehicle-models", { make: "", name: "X", bodyType: "boat", capacityKg: -1 });
    expect(result.status).toBe(422);
    const paths = result.body.issues.map((issue: { path: string[] }) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["make", "bodyType", "capacityKg"]));
  });

  test("a duplicate make and name in one company conflicts, but another company may reuse it", async () => {
    await createModel(owner, { name: "Dup" });
    const again = await owner.post("/vehicle-models", sampleModel({ name: "Dup" }));
    expect([again.status, again.body.code]).toEqual([409, "fleet.model-exists"]);
    expect((await rival.post("/vehicle-models", sampleModel({ name: "Dup" }))).status).toBe(201);
  });

  test("update changes fields and rejects a rename onto an existing model", async () => {
    const a = await createModel(owner, { name: "Upd-A" });
    await createModel(owner, { name: "Upd-B" });
    const changed = await owner.patch(`/vehicle-models/${a.id}`, { capacityKg: 4200 });
    expect([changed.status, changed.body.capacityKg]).toEqual([200, 4200]);
    const clash = await owner.patch(`/vehicle-models/${a.id}`, { name: "Upd-B" });
    expect([clash.status, clash.body.code]).toEqual([409, "fleet.model-exists"]);
  });

  test("delete removes an unused model and blocks a model that vehicles use", async () => {
    const unused = await createModel(owner, { name: "Del-Unused" });
    expect((await owner.delete(`/vehicle-models/${unused.id}`)).status).toBe(200);
    expect((await owner.delete(`/vehicle-models/${unused.id}`)).status).toBe(404);

    const used = await createModel(owner, { name: "Del-Used" });
    await owner.post("/vehicles", sampleVehicle(used.id, { plate: "DEL 1" }));
    const blocked = await owner.delete(`/vehicle-models/${used.id}`);
    expect([blocked.status, blocked.body.code, blocked.body.data.vehicles]).toEqual([409, "fleet.model-in-use", 1]);
  });

  test("another company's models are invisible and immutable", async () => {
    const mine = await createModel(owner, { name: "Isolated" });
    expect((await rival.patch(`/vehicle-models/${mine.id}`, { capacityKg: 1 })).status).toBe(404);
    expect((await rival.delete(`/vehicle-models/${mine.id}`)).status).toBe(404);
    const rivalList = await rival.get("/vehicle-models?limit=100");
    expect(rivalList.body.items.some((item: { id: string }) => item.id === mine.id)).toBe(false);
    expect((await owner.get("/vehicle-models")).body.items.some((item: { id: string }) => item.id === mine.id)).toBe(true);
  });

  test("only owners and admins manage models; dispatchers may read them", async () => {
    expect((await admin.post("/vehicle-models", sampleModel({ name: "By-Admin" }))).status).toBe(201);
    expect((await dispatcher.post("/vehicle-models", sampleModel({ name: "By-Dispatcher" }))).status).toBe(403);
    expect((await dispatcher.get("/vehicle-models")).status).toBe(200);
  });

  test("list paginates", async () => {
    for (const n of [1, 2, 3]) await createModel(owner, { name: `Page-${n}` });
    const page = await owner.get("/vehicle-models?limit=2&offset=0");
    expect(page.body.items).toHaveLength(2);
    expect(page.body).toMatchObject({ limit: 2, offset: 0 });
    expect((await owner.get("/vehicle-models?limit=0")).status).toBe(422);
    expect((await owner.get("/vehicle-models?limit=101")).status).toBe(422);
  });
});

describe("vehicles", () => {
  let model: { id: string };
  beforeAll(async () => {
    model = await createModel(owner, { name: "Vehicle-Base" });
  });

  test("create normalises the plate and stores the VIN", async () => {
    const result = await owner.post("/vehicles", sampleVehicle(model.id, { plate: "abc   123", vin: "1hgcm82633a004352" }));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ plate: "ABC 123", vin: "1HGCM82633A004352", status: "active", year: 2021 });
  });

  test("plates are unique per company regardless of case and spacing", async () => {
    await owner.post("/vehicles", sampleVehicle(model.id, { plate: "UNI 1" }));
    const again = await owner.post("/vehicles", sampleVehicle(model.id, { plate: "uni  1" }));
    expect([again.status, again.body.code]).toEqual([409, "fleet.plate-taken"]);
    const otherModel = await createModel(rival, { name: "Rival-Base" });
    expect((await rival.post("/vehicles", sampleVehicle(otherModel.id, { plate: "UNI 1" }))).status).toBe(201);
  });

  test("VINs are unique per company and validated", async () => {
    await owner.post("/vehicles", sampleVehicle(model.id, { plate: "VIN 1", vin: "JH4KA7561PC008269" }));
    const dup = await owner.post("/vehicles", sampleVehicle(model.id, { plate: "VIN 2", vin: "JH4KA7561PC008269" }));
    expect([dup.status, dup.body.code]).toEqual([409, "fleet.vin-taken"]);
    const bad = await owner.post("/vehicles", sampleVehicle(model.id, { plate: "VIN 3", vin: "TOO-SHORT" }));
    expect(bad.status).toBe(422);
    // Vehicles without a VIN never collide with each other.
    expect((await owner.post("/vehicles", sampleVehicle(model.id, { plate: "NOVIN 1" }))).status).toBe(201);
    expect((await owner.post("/vehicles", sampleVehicle(model.id, { plate: "NOVIN 2" }))).status).toBe(201);
  });

  test("year bounds are enforced", async () => {
    expect((await owner.post("/vehicles", sampleVehicle(model.id, { plate: "YR 1", year: 1950 }))).status).toBe(422);
    expect((await owner.post("/vehicles", sampleVehicle(model.id, { plate: "YR 2", year: 2999 }))).status).toBe(422);
  });

  test("the model must exist in the same company", async () => {
    const missing = await owner.post("/vehicles", sampleVehicle("nope", { plate: "MOD 1" }));
    expect([missing.status, missing.body.code]).toEqual([404, "fleet.model-not-found"]);
    const foreign = await rival.post("/vehicles", sampleVehicle(model.id, { plate: "MOD 2" }));
    expect([foreign.status, foreign.body.code]).toEqual([404, "fleet.model-not-found"]);
  });

  test("get, list and filter are scoped to the company", async () => {
    const created = (await owner.post("/vehicles", sampleVehicle(model.id, { plate: "SCOPE 1" }))).body;
    expect((await owner.get(`/vehicles/${created.id}`)).body.plate).toBe("SCOPE 1");
    const foreign = await rival.get(`/vehicles/${created.id}`);
    expect([foreign.status, foreign.body.code]).toEqual([404, "fleet.vehicle-not-found"]);
    expect((await rival.get("/vehicles")).body.items.some((v: { id: string }) => v.id === created.id)).toBe(false);

    await owner.put(`/vehicles/${created.id}/status`, { status: "maintenance" });
    const maintenance = await owner.get("/vehicles?status=maintenance");
    expect(maintenance.body.items.map((v: { id: string }) => v.id)).toContain(created.id);
    expect((await owner.get("/vehicles?status=active")).body.items.some((v: { id: string }) => v.id === created.id)).toBe(false);
    expect((await owner.get("/vehicles?status=flying")).status).toBe(422);
  });

  test("update changes plate and year, and refuses a taken plate", async () => {
    const a = (await owner.post("/vehicles", sampleVehicle(model.id, { plate: "UPD 1" }))).body;
    await owner.post("/vehicles", sampleVehicle(model.id, { plate: "UPD 2" }));
    const changed = await owner.patch(`/vehicles/${a.id}`, { plate: "upd 9", year: 2023 });
    expect(changed.body).toMatchObject({ plate: "UPD 9", year: 2023 });
    const clash = await owner.patch(`/vehicles/${a.id}`, { plate: "UPD 2" });
    expect([clash.status, clash.body.code]).toEqual([409, "fleet.plate-taken"]);
    expect((await rival.patch(`/vehicles/${a.id}`, { year: 2020 })).status).toBe(404);
  });

  test("status lifecycle: active <-> maintenance, retire is terminal", async () => {
    const v = (await owner.post("/vehicles", sampleVehicle(model.id, { plate: "LIFE 1" }))).body;
    expect((await dispatcher.put(`/vehicles/${v.id}/status`, { status: "maintenance" })).body.status).toBe("maintenance");
    const same = await dispatcher.put(`/vehicles/${v.id}/status`, { status: "maintenance" });
    expect([same.status, same.body.code]).toEqual([409, "fleet.invalid-status-transition"]);
    expect((await dispatcher.put(`/vehicles/${v.id}/status`, { status: "active" })).body.status).toBe("active");
    expect((await dispatcher.put(`/vehicles/${v.id}/status`, { status: "retired" })).status).toBe(422);

    const forbidden = await dispatcher.post(`/vehicles/${v.id}/retire`);
    expect(forbidden.status).toBe(403);
    const retired = await admin.post(`/vehicles/${v.id}/retire`);
    expect(retired.body.status).toBe("retired");

    for (const attempt of [
      await admin.post(`/vehicles/${v.id}/retire`),
      await dispatcher.put(`/vehicles/${v.id}/status`, { status: "active" }),
    ]) {
      expect([attempt.status, attempt.body.code]).toEqual([409, "fleet.invalid-status-transition"]);
    }
    const edit = await admin.patch(`/vehicles/${v.id}`, { year: 2022 });
    expect([edit.status, edit.body.code]).toEqual([409, "fleet.vehicle-retired"]);
  });

  test("other companies cannot change or retire a vehicle", async () => {
    const v = (await owner.post("/vehicles", sampleVehicle(model.id, { plate: "FOREIGN 1" }))).body;
    expect((await rival.put(`/vehicles/${v.id}/status`, { status: "maintenance" })).status).toBe(404);
    expect((await rival.post(`/vehicles/${v.id}/retire`)).status).toBe(404);
    expect((await owner.get(`/vehicles/${v.id}`)).body.status).toBe("active");
  });

  test("concurrent registrations of the same plate create exactly one vehicle", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => owner.post("/vehicles", sampleVehicle(model.id, { plate: "RACE 1" }))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  });
});
