import { beforeAll, describe, expect, test } from "bun:test";
import { addMember, registerCompany, signUp, startHarness, TestUser, type Harness } from "../support/harness.js";

let harness: Harness;
let owner: TestUser;

beforeAll(async () => {
  harness = await startHarness();
  owner = await registerCompany(harness, "Accessco");
}, 120_000);

describe("registration and sessions", () => {
  test("a user can sign up, sign out and sign back in", async () => {
    const user = await signUp(harness, "Sam Signin", "sam-signin@example.com");
    expect((await user.post("/api/auth/sign-out")).status).toBe(200);
    const again = await user.post("/api/auth/sign-in/email", { email: "sam-signin@example.com", password: "correct-horse-battery" });
    expect(again.status).toBe(200);
  });

  test("sign-in with a wrong password is rejected", async () => {
    await signUp(harness, "Wrong Pass", "wrong-pass@example.com");
    const stranger = new TestUser(harness, "wrong-pass@example.com");
    const result = await stranger.post("/api/auth/sign-in/email", { email: "wrong-pass@example.com", password: "not-the-password" });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  test("registering a company stores its profile and makes the creator the owner", async () => {
    const founder = await signUp(harness, "Fatima Founder", "fatima-founder@example.com");
    const created = await founder.post("/api/auth/organization/create", {
      name: "Delta Haulage",
      slug: "delta-haulage",
      legalName: "Delta Haulage LLC",
      taxId: "TX-889",
      phone: "+20100000000",
      address: "1 Nile Corniche",
      country: "EG",
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: "Delta Haulage", legalName: "Delta Haulage LLC", taxId: "TX-889", country: "EG" });
    expect(created.body.members[0].role).toBe("owner");
    const session = await founder.get("/api/auth/get-session");
    expect(session.body.session.activeOrganizationId).toBe(created.body.id);
  });

  test("company slugs are unique", async () => {
    const other = await signUp(harness, "Slug Thief", "slug-thief@example.com");
    const result = await other.post("/api/auth/organization/create", { name: "Copy", slug: "accessco" });
    expect(result.status).toBeGreaterThanOrEqual(400);
  });
});

describe("access rules", () => {
  test("anonymous callers get 401 on every protected resource", async () => {
    const anonymous = new TestUser(harness, "nobody@example.com");
    for (const path of ["/vehicles", "/vehicle-models", "/drivers", "/driver-assignments"]) {
      const result = await anonymous.get(path);
      expect(result.status).toBe(401);
      expect(result.body.code).toBe("unauthenticated");
    }
  });

  test("a signed-in user with no company cannot reach company data", async () => {
    const loner = await signUp(harness, "Lone Wolf", "lone-wolf@example.com");
    for (const path of ["/vehicles", "/drivers"]) {
      const result = await loner.get(path);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("access-denied");
    }
  });

  test("invited roles get exactly the permissions they were granted", async () => {
    const admin = await addMember(harness, owner, "Accessadmin", "admin");
    const dispatcher = await addMember(harness, owner, "Accessdispatcher", "dispatcher");
    const driver = await addMember(harness, owner, "Accessdriver", "driver");
    const reader = await addMember(harness, owner, "Accessreader", "member");

    const model = { make: "Ford", name: "Transit", bodyType: "van", capacityKg: 1200 };
    const expectations: Array<[string, TestUser, number]> = [
      ["owner", owner, 201],
      ["admin", admin, 409],
      ["dispatcher", dispatcher, 403],
      ["driver", driver, 403],
      ["member", reader, 403],
    ];
    for (const [role, user, status] of expectations) {
      const result = await user.post("/vehicle-models", model);
      expect([role, result.status]).toEqual([role, status]);
    }
    // Everyone in the company can read the fleet.
    for (const user of [owner, admin, dispatcher, driver, reader]) {
      expect((await user.get("/vehicle-models")).status).toBe(200);
    }
  });

  test("a member of one company cannot act in another", async () => {
    const rival = await registerCompany(harness, "Rivalco");
    expect((await owner.post("/vehicle-models", { make: "Mack", name: "Anthem", bodyType: "semi_trailer", capacityKg: 30000 })).status).toBe(201);
    const seen = await rival.get("/vehicle-models");
    expect(seen.status).toBe(200);
    expect(seen.body.items.find((item: { make: string }) => item.make === "Mack")).toBeUndefined();
  });
});
