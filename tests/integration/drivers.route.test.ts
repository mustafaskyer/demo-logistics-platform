import { beforeAll, describe, expect, test } from "bun:test";
import {
  addMember,
  eventually,
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
let driverRole: TestUser;
let rival: TestUser;
let modelId: string;
let sequence = 0;

const newDriver = async (user: TestUser = owner, overrides: Record<string, unknown> = {}) => {
  sequence += 1;
  const result = await user.post("/drivers", sampleDriver({ licenseNumber: `LIC-${1000 + sequence}`, ...overrides }));
  if (result.status !== 201) throw new Error(`driver setup failed: ${JSON.stringify(result.body)}`);
  return result.body as { id: string };
};
const newVehicle = async (user: TestUser = owner, id: string = modelId) => {
  sequence += 1;
  const result = await user.post("/vehicles", sampleVehicle(id, { plate: `DRV ${sequence}` }));
  if (result.status !== 201) throw new Error(`vehicle setup failed: ${JSON.stringify(result.body)}`);
  return result.body as { id: string };
};
const currentAssignments = async (user: TestUser = dispatcher) =>
  (await user.get("/driver-assignments")).body.items as Array<{ driverId: string; vehicleId: string }>;

beforeAll(async () => {
  harness = await startHarness();
  owner = await registerCompany(harness, "Driverco");
  admin = await addMember(harness, owner, "Driveradmin", "admin");
  dispatcher = await addMember(harness, owner, "Driverdispatcher", "dispatcher");
  driverRole = await addMember(harness, owner, "Driveruser", "driver");
  rival = await registerCompany(harness, "Driverrival");
  modelId = (await owner.post("/vehicle-models", sampleModel({ name: "Drivers-Base" }))).body.id;
}, 120_000);

describe("driver profiles", () => {
  test("create normalises the license and returns the public shape", async () => {
    const result = await owner.post("/drivers", sampleDriver({ licenseNumber: "eg-create-1", licenseClass: "c" }));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ licenseNumber: "EG-CREATE-1", licenseClass: "C", status: "active", userId: null });
    expect(result.body.organizationId).toBeUndefined();
  });

  test("validation covers phone, dates and names", async () => {
    const result = await owner.post("/drivers", { fullName: "A", phone: "abc", licenseNumber: "X", licenseClass: "", licenseExpiresOn: "2099-02-30" });
    expect(result.status).toBe(422);
    const paths = result.body.issues.map((issue: { path: string[] }) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["fullName", "phone", "licenseNumber", "licenseExpiresOn"]));
  });

  test("an expired license is refused", async () => {
    const result = await owner.post("/drivers", sampleDriver({ licenseNumber: "EG-OLD-1", licenseExpiresOn: "2020-01-01" }));
    expect([result.status, result.body.code]).toEqual([422, "drivers.license-expired"]);
  });

  test("licenses are unique per company, ignoring case", async () => {
    await newDriver(owner, { licenseNumber: "EG-UNIQUE-1" });
    const dup = await owner.post("/drivers", sampleDriver({ licenseNumber: "eg-unique-1" }));
    expect([dup.status, dup.body.code]).toEqual([409, "drivers.license-taken"]);
    expect((await rival.post("/drivers", sampleDriver({ licenseNumber: "EG-UNIQUE-1" }))).status).toBe(201);
  });

  test("a driver can be linked to a company login once", async () => {
    const me = (await driverRole.get("/api/auth/get-session")).body.user.id as string;
    const linked = await owner.post("/drivers", sampleDriver({ licenseNumber: "EG-LINK-1", userId: me }));
    expect([linked.status, linked.body.userId]).toEqual([201, me]);
    const again = await owner.post("/drivers", sampleDriver({ licenseNumber: "EG-LINK-2", userId: me }));
    expect([again.status, again.body.code]).toEqual([409, "drivers.user-already-driver"]);

    const outsider = (await rival.get("/api/auth/get-session")).body.user.id as string;
    const foreign = await owner.post("/drivers", sampleDriver({ licenseNumber: "EG-LINK-3", userId: outsider }));
    expect([foreign.status, foreign.body.code]).toEqual([422, "drivers.user-not-in-company"]);
  });

  test("get, update and list are scoped to the company", async () => {
    const d = await newDriver();
    expect((await owner.get(`/drivers/${d.id}`)).body.id).toBe(d.id);
    const updated = await admin.patch(`/drivers/${d.id}`, { fullName: "Updated Name", licenseClass: "d" });
    expect(updated.body).toMatchObject({ fullName: "Updated Name", licenseClass: "D" });

    const foreign = await rival.get(`/drivers/${d.id}`);
    expect([foreign.status, foreign.body.code]).toEqual([404, "drivers.driver-not-found"]);
    expect((await rival.patch(`/drivers/${d.id}`, { fullName: "Hacked" })).status).toBe(404);
    expect((await rival.get("/drivers")).body.items.some((x: { id: string }) => x.id === d.id)).toBe(false);
  });

  test("update enforces the license rules", async () => {
    const a = await newDriver();
    const b = await newDriver();
    const taken = await owner.patch(`/drivers/${a.id}`, { licenseNumber: (await owner.get(`/drivers/${b.id}`)).body.licenseNumber });
    expect([taken.status, taken.body.code]).toEqual([409, "drivers.license-taken"]);
    const expired = await owner.patch(`/drivers/${a.id}`, { licenseExpiresOn: "2001-01-01" });
    expect([expired.status, expired.body.code]).toEqual([422, "drivers.license-expired"]);
  });

  test("only owners and admins manage drivers; dispatchers and drivers may read", async () => {
    expect((await admin.post("/drivers", sampleDriver({ licenseNumber: "EG-ROLE-1" }))).status).toBe(201);
    for (const user of [dispatcher, driverRole]) {
      expect((await user.post("/drivers", sampleDriver({ licenseNumber: "EG-ROLE-2" }))).status).toBe(403);
      expect((await user.get("/drivers")).status).toBe(200);
    }
    const d = await newDriver();
    expect((await dispatcher.post(`/drivers/${d.id}/deactivate`)).status).toBe(403);
    expect((await dispatcher.patch(`/drivers/${d.id}`, { fullName: "Nope Nope" })).status).toBe(403);
  });

  test("deactivate and reactivate; an expired license blocks reactivation", async () => {
    const d = await newDriver();
    expect((await owner.post(`/drivers/${d.id}/deactivate`)).body.status).toBe("inactive");
    expect((await owner.get("/drivers?status=inactive")).body.items.map((x: { id: string }) => x.id)).toContain(d.id);
    expect((await owner.post(`/drivers/${d.id}/activate`)).body.status).toBe("active");

    await owner.post(`/drivers/${d.id}/deactivate`);
    await harness.sql.unsafe(`UPDATE driver SET "licenseExpiresOn" = '2000-01-01' WHERE id = '${d.id}'`);
    const blocked = await owner.post(`/drivers/${d.id}/activate`);
    expect([blocked.status, blocked.body.code]).toEqual([422, "drivers.license-expired"]);
  });
});

describe("assignments", () => {
  test("a dispatcher assigns an active vehicle to an active driver", async () => {
    const d = await newDriver();
    const v = await newVehicle();
    const result = await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: v.id });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ driverId: d.id, vehicleId: v.id, unassignedAt: null });
    expect(await currentAssignments()).toEqual(expect.arrayContaining([expect.objectContaining({ driverId: d.id, vehicleId: v.id })]));
  });

  test("one open assignment per driver and per vehicle", async () => {
    const d1 = await newDriver();
    const d2 = await newDriver();
    const v1 = await newVehicle();
    const v2 = await newVehicle();
    await dispatcher.post("/driver-assignments", { driverId: d1.id, vehicleId: v1.id });

    const driverBusy = await dispatcher.post("/driver-assignments", { driverId: d1.id, vehicleId: v2.id });
    expect([driverBusy.status, driverBusy.body.code]).toEqual([409, "drivers.driver-already-assigned"]);
    const vehicleBusy = await dispatcher.post("/driver-assignments", { driverId: d2.id, vehicleId: v1.id });
    expect([vehicleBusy.status, vehicleBusy.body.code]).toEqual([409, "drivers.vehicle-already-assigned"]);
  });

  test("concurrent assignment of one vehicle to different drivers yields exactly one winner", async () => {
    const v = await newVehicle();
    const drivers = await Promise.all([newDriver(), newDriver(), newDriver(), newDriver()]);
    const results = await Promise.all(drivers.map((d) => dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: v.id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await currentAssignments()).filter((a) => a.vehicleId === v.id)).toHaveLength(1);
  });

  test("inactive drivers and unavailable vehicles cannot be assigned", async () => {
    const inactive = await newDriver();
    await owner.post(`/drivers/${inactive.id}/deactivate`);
    const v = await newVehicle();
    const r1 = await dispatcher.post("/driver-assignments", { driverId: inactive.id, vehicleId: v.id });
    expect([r1.status, r1.body.code]).toEqual([409, "drivers.driver-inactive"]);

    const d = await newDriver();
    const down = await newVehicle();
    await dispatcher.put(`/vehicles/${down.id}/status`, { status: "maintenance" });
    const r2 = await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: down.id });
    expect([r2.status, r2.body.code]).toEqual([409, "drivers.vehicle-unavailable"]);

    const r3 = await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: "does-not-exist" });
    expect([r3.status, r3.body.code]).toEqual([409, "drivers.vehicle-unavailable"]);
    const r4 = await dispatcher.post("/driver-assignments", { driverId: "ghost", vehicleId: v.id });
    expect([r4.status, r4.body.code]).toEqual([404, "drivers.driver-not-found"]);
  });

  test("a driver whose license expired after hiring cannot be assigned", async () => {
    const d = await newDriver();
    await harness.sql.unsafe(`UPDATE driver SET "licenseExpiresOn" = '2000-01-01' WHERE id = '${d.id}'`);
    const result = await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: (await newVehicle()).id });
    expect([result.status, result.body.code]).toEqual([422, "drivers.license-expired"]);
  });

  test("another company's driver or vehicle is never assignable", async () => {
    const foreignVehicle = await newVehicle(rival, (await rival.post("/vehicle-models", sampleModel({ name: "Rival-Drv" }))).body.id);
    const mine = await newDriver();
    const result = await dispatcher.post("/driver-assignments", { driverId: mine.id, vehicleId: foreignVehicle.id });
    expect([result.status, result.body.code]).toEqual([409, "drivers.vehicle-unavailable"]);

    const foreignDriver = await newDriver(rival);
    const r2 = await dispatcher.post("/driver-assignments", { driverId: foreignDriver.id, vehicleId: (await newVehicle()).id });
    expect([r2.status, r2.body.code]).toEqual([404, "drivers.driver-not-found"]);
    expect(await currentAssignments(rival)).not.toEqual(expect.arrayContaining([expect.objectContaining({ driverId: mine.id })]));
  });

  test("unassign releases the vehicle, keeps history, and cannot be repeated", async () => {
    const d = await newDriver();
    const v = await newVehicle();
    await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: v.id });
    const released = await dispatcher.delete(`/drivers/${d.id}/vehicle`);
    expect(released.status).toBe(200);
    expect(released.body.unassignedAt).not.toBeNull();
    const again = await dispatcher.delete(`/drivers/${d.id}/vehicle`);
    expect([again.status, again.body.code]).toEqual([404, "drivers.no-open-assignment"]);

    expect((await currentAssignments()).some((a) => a.driverId === d.id)).toBe(false);
    const history = (await dispatcher.get("/driver-assignments?includeClosed=true")).body.items as Array<{ driverId: string }>;
    expect(history.some((a) => a.driverId === d.id)).toBe(true);
    // The vehicle is free again.
    expect((await dispatcher.post("/driver-assignments", { driverId: (await newDriver()).id, vehicleId: v.id })).status).toBe(201);
  });

  test("a vehicle that goes into maintenance or is retired loses its driver (event reaction)", async () => {
    for (const action of ["maintenance", "retire"] as const) {
      const d = await newDriver();
      const v = await newVehicle();
      await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: v.id });
      if (action === "maintenance") await dispatcher.put(`/vehicles/${v.id}/status`, { status: "maintenance" });
      else await admin.post(`/vehicles/${v.id}/retire`);
      const left = await eventually(currentAssignments, (items) => !items.some((a) => a.vehicleId === v.id));
      expect([action, left.some((a) => a.vehicleId === v.id)]).toEqual([action, false]);
    }
  });

  test("deactivating a driver releases their vehicle in the same transaction", async () => {
    const d = await newDriver();
    const v = await newVehicle();
    await dispatcher.post("/driver-assignments", { driverId: d.id, vehicleId: v.id });
    expect((await owner.post(`/drivers/${d.id}/deactivate`)).status).toBe(200);
    expect((await currentAssignments()).some((a) => a.driverId === d.id)).toBe(false);
  });

  test("role matrix for assignments", async () => {
    const d = await newDriver();
    const v = await newVehicle();
    const denied = await driverRole.post("/driver-assignments", { driverId: d.id, vehicleId: v.id });
    expect([denied.status, denied.body.code]).toEqual([403, "access-denied"]);
    expect((await driverRole.get("/driver-assignments")).status).toBe(200);
    expect((await admin.post("/driver-assignments", { driverId: d.id, vehicleId: v.id })).status).toBe(201);
    expect((await driverRole.delete(`/drivers/${d.id}/vehicle`)).status).toBe(403);
    expect((await rival.delete(`/drivers/${d.id}/vehicle`)).status).toBe(404);
  });
});
