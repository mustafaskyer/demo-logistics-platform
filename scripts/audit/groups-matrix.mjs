// Group "matrix": every route x every actor. Expected status comes from src/services/auth/permissions.ts.
import { problemCode, all, isProblemJson } from "./lib.mjs";

const ALL5 = ["owner", "admin", "dispatcher", "driver", "member"];
const MANAGE = ["owner", "admin"];
const OPS = ["owner", "admin", "dispatcher"];

export async function matrixGroup(audit, ctx, fx) {
  const G = "matrix";
  const base = {}; // shared company-A fixtures
  base.model = await fx.model();
  base.vehicle = await fx.vehicle(base.model?.id);
  base.driver = await fx.driver();
  const docUp = await fx.document({ ownerType: "driver", ownerId: base.driver?.id, upload: true, confirm: true });
  base.docConfirmed = docUp?.document;
  const docPending = await fx.document({ ownerType: "driver", ownerId: base.driver?.id });
  base.docPending = docPending?.document;

  const itemsContain = (id) => (r) => (Array.isArray(r.body?.items) && r.body.items.some((i) => i.id === id) ? true : `list does not contain ${id}`);
  const itemsExclude = (id) => (r) => (Array.isArray(r.body?.items) && !r.body.items.some((i) => i.id === id) ? true : `list leaks ${id}`);

  // Each route: how to call it for an actor, for the "allowed" case (fresh fixtures) and the others.
  // build(fresh) -> {path, body}; foreign(): what B gets; okVerify; allowed roles
  const routes = [
    { key: "GET /hello", method: "GET", roles: "public", ok: 200, build: async () => ({ path: "/hello?name=matrix" }), verify: (r) => (r.body?.message === "Hello, matrix!" ? true : "greeting") },
    { key: "GET /vehicle-models", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: "/vehicle-models" }), foreign: 200, foreignVerify: itemsExclude(base.model?.id), verify: itemsContain(base.model?.id) },
    { key: "POST /vehicle-models", method: "POST", roles: MANAGE, ok: 201, build: async () => ({ path: "/vehicle-models", body: { make: "Matrix", name: audit.modelName("P"), bodyType: "van", capacityKg: 1000 } }), foreign: 201 },
    { key: "PATCH /vehicle-models/:id", method: "PATCH", roles: MANAGE, ok: 200, build: async (fresh) => ({ path: `/vehicle-models/${(fresh ? await fx.model() : base.model)?.id}`, body: { capacityKg: 4200 } }), foreign: 404 },
    { key: "DELETE /vehicle-models/:id", method: "DELETE", roles: MANAGE, ok: 200, build: async (fresh) => ({ path: `/vehicle-models/${(fresh ? await fx.model() : base.model)?.id}` }), foreign: 404 },
    { key: "GET /vehicles", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: "/vehicles" }), foreign: 200, foreignVerify: itemsExclude(base.vehicle?.id), verify: itemsContain(base.vehicle?.id) },
    { key: "POST /vehicles", method: "POST", roles: MANAGE, ok: 201, build: async () => ({ path: "/vehicles", body: { modelId: base.model?.id, plate: audit.plate(), year: 2022 } }), foreign: 404, foreignCode: "fleet.model-not-found" },
    { key: "GET /vehicles/:id", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: `/vehicles/${base.vehicle?.id}` }), foreign: 404, foreignCode: "fleet.vehicle-not-found" },
    { key: "PATCH /vehicles/:id", method: "PATCH", roles: OPS, ok: 200, build: async (fresh) => ({ path: `/vehicles/${(fresh ? await fx.vehicle(base.model?.id) : base.vehicle)?.id}`, body: { year: 2023 } }), foreign: 404 },
    { key: "PUT /vehicles/:id/status", method: "PUT", roles: OPS, ok: 200, build: async (fresh) => ({ path: `/vehicles/${(fresh ? await fx.vehicle(base.model?.id) : base.vehicle)?.id}/status`, body: { status: "maintenance" } }), foreign: 404 },
    { key: "POST /vehicles/:id/retire", method: "POST", roles: MANAGE, ok: 200, build: async (fresh) => ({ path: `/vehicles/${(fresh ? await fx.vehicle(base.model?.id) : base.vehicle)?.id}/retire` }), foreign: 404 },
    { key: "GET /drivers", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: "/drivers" }), foreign: 200, foreignVerify: itemsExclude(base.driver?.id), verify: itemsContain(base.driver?.id) },
    { key: "POST /drivers", method: "POST", roles: MANAGE, ok: 201, build: async () => ({ path: "/drivers", body: { fullName: "Matrix Driver", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "b", licenseExpiresOn: "2099-01-01" } }), foreign: 201 },
    { key: "GET /drivers/:id", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: `/drivers/${base.driver?.id}` }), foreign: 404, foreignCode: "drivers.driver-not-found" },
    { key: "PATCH /drivers/:id", method: "PATCH", roles: MANAGE, ok: 200, build: async (fresh) => ({ path: `/drivers/${(fresh ? await fx.driver() : base.driver)?.id}`, body: { fullName: "Matrix Renamed" } }), foreign: 404 },
    { key: "POST /drivers/:id/activate", method: "POST", roles: MANAGE, ok: 200, build: async (fresh) => ({ path: `/drivers/${(fresh ? await fx.driver() : base.driver)?.id}/activate` }), foreign: 404 },
    { key: "POST /drivers/:id/deactivate", method: "POST", roles: MANAGE, ok: 200, build: async (fresh) => ({ path: `/drivers/${(fresh ? await fx.driver() : base.driver)?.id}/deactivate` }), foreign: 404 },
    { key: "DELETE /drivers/:id/vehicle", method: "DELETE", roles: OPS, ok: 200, build: async (fresh) => {
        if (!fresh) return { path: `/drivers/${base.driver?.id}/vehicle` };
        const d = await fx.driver();
        const v = await fx.vehicle(base.model?.id);
        await fx.assign(d?.id, v?.id);
        return { path: `/drivers/${d?.id}/vehicle` };
      }, foreign: 404 },
    { key: "GET /driver-assignments", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: "/driver-assignments" }), foreign: 200, verify: (r) => (Array.isArray(r.body?.items) ? true : "items array") },
    { key: "POST /driver-assignments", method: "POST", roles: OPS, ok: 201, build: async (fresh) => {
        if (!fresh) return { path: "/driver-assignments", body: { driverId: base.driver?.id, vehicleId: base.vehicle?.id } };
        const d = await fx.driver();
        const v = await fx.vehicle(base.model?.id);
        return { path: "/driver-assignments", body: { driverId: d?.id, vehicleId: v?.id } };
      }, foreign: 404, foreignCode: "drivers.driver-not-found" },
    { key: "GET /documents", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: `/documents?ownerType=driver&ownerId=${base.driver?.id}` }), foreign: 200, foreignVerify: (r) => (Array.isArray(r.body?.items) && r.body.items.length === 0 ? true : "foreign company sees documents"), verify: itemsContain(base.docConfirmed?.id) },
    { key: "POST /documents", method: "POST", roles: MANAGE, ok: 201, build: async () => ({ path: "/documents", body: { ownerType: "driver", ownerId: base.driver?.id, kind: "license", filename: "matrix.pdf", contentType: "application/pdf", sizeBytes: 100 } }), foreign: 404, foreignCode: "documents.owner-not-found" },
    { key: "POST /documents/:id/confirm", method: "POST", roles: MANAGE, ok: 200, build: async (fresh) => {
        if (!fresh) return { path: `/documents/${base.docPending?.id}/confirm` };
        const d = await fx.document({ ownerType: "driver", ownerId: base.driver?.id, upload: true });
        return { path: `/documents/${d?.document?.id}/confirm` };
      }, foreign: 404, foreignCode: "documents.document-not-found" },
    { key: "GET /documents/:id/download", method: "GET", roles: ALL5, ok: 200, build: async () => ({ path: `/documents/${base.docConfirmed?.id}/download` }), foreign: 404, foreignCode: "documents.document-not-found", verify: (r) => (typeof r.body?.url === "string" ? true : "no url") },
    { key: "DELETE /documents/:id", method: "DELETE", roles: MANAGE, ok: 200, build: async (fresh) => {
        const d = fresh ? (await fx.document({ ownerType: "driver", ownerId: base.driver?.id, upload: true, confirm: true }))?.document : base.docConfirmed;
        return { path: `/documents/${d?.id}` };
      }, foreign: 404 },
  ];

  const actors = [
    ["owner", ctx.owner], ["admin", ctx.admin], ["dispatcher", ctx.dispatcher], ["driver", ctx.driver], ["member", ctx.member],
    ["ownerB", ctx.ownerB], ["nocompany", ctx.nocompany], ["anon", ctx.anon],
  ];

  for (const route of routes) {
    for (const [label, actor] of actors) {
      let expect;
      let check;
      let basis = "app-contract";
      let fresh = false;
      let verify;
      const isRole = ALL5.includes(label);
      if (route.roles === "public") {
        expect = route.ok;
        check = "public route, no access rule";
        verify = route.verify;
        basis = "relkit-docs";
      } else if (label === "anon") {
        expect = 401;
        check = "code unauthenticated, application/problem+json";
        verify = all(problemCode("unauthenticated"), isProblemJson);
      } else if (label === "nocompany") {
        expect = 403;
        check = "code access-denied (signed in, no active company)";
        verify = all(problemCode("access-denied"), isProblemJson);
      } else if (label === "ownerB") {
        // Company B's owner holds every permission, so the request reaches the handler and must not see company A.
        expect = route.foreign;
        check = route.foreignCode ? `code ${route.foreignCode}` : "company A data is not visible or changeable";
        verify = route.foreignCode ? problemCode(route.foreignCode) : route.foreignVerify;
        basis = "app-contract";
      } else if (isRole) {
        if (route.roles.includes(label)) {
          expect = route.ok;
          fresh = true;
          verify = route.verify;
          check = `allowed by permissions.ts: ${label}`;
        } else {
          expect = 403;
          check = "code access-denied";
          verify = all(problemCode("access-denied"), isProblemJson);
        }
      }
      const built = await route.build(fresh);
      await audit.step({
        group: G, name: `${route.key} | ${label}`, actor, method: route.method, path: built.path, body: built.body,
        expect, check, basis, verify,
      });
    }
  }
}
