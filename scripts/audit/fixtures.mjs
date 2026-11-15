// Fixture builders shared by the groups. Every fixture request is itself recorded (group "fixtures",
// fixture:true) so the log is a literal record of everything sent to the server.
import { Actor, problemCode } from "./lib.mjs";

export const PASSWORD = "correct-horse-battery";
export const ROLES = ["owner", "admin", "dispatcher", "driver", "member"];

export function makeFixtures(audit, ctx) {
  const fx = {};
  const G = "fixtures";

  fx.pdf = (text) => new TextEncoder().encode(`%PDF-1.4 ${text}`);

  fx.model = async (over = {}, actor = ctx.owner) => {
    const n = audit.next();
    const res = await audit.step({
      group: G, name: `model#${n}`, fixture: true, actor, method: "POST", path: "/vehicle-models",
      body: { make: "Isuzu", name: audit.modelName("F"), bodyType: "box_truck", capacityKg: 3500, ...over },
      expect: 201,
    });
    return res.status === 201 ? res.body : undefined;
  };

  fx.vehicle = async (modelId, over = {}, actor = ctx.owner) => {
    const n = audit.next();
    const res = await audit.step({
      group: G, name: `vehicle#${n}`, fixture: true, actor, method: "POST", path: "/vehicles",
      body: { modelId, plate: audit.plate(), year: 2022, ...over },
      expect: 201,
    });
    return res.status === 201 ? res.body : undefined;
  };

  fx.driver = async (over = {}, actor = ctx.owner) => {
    const n = audit.next();
    const res = await audit.step({
      group: G, name: `driver#${n}`, fixture: true, actor, method: "POST", path: "/drivers",
      body: { fullName: "Audit Driver", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "b", licenseExpiresOn: "2099-01-01", ...over },
      expect: 201,
    });
    return res.status === 201 ? res.body : undefined;
  };

  fx.assign = async (driverId, vehicleId, actor = ctx.owner) => {
    const n = audit.next();
    const res = await audit.step({
      group: G, name: `assignment#${n}`, fixture: true, actor, method: "POST", path: "/driver-assignments",
      body: { driverId, vehicleId }, expect: 201,
    });
    return res.status === 201 ? res.body : undefined;
  };

  /** Requests an upload. Optionally PUTs the bytes and confirms. Returns {document, uploadUrl, bytes}. */
  fx.document = async ({ ownerType = "driver", ownerId, kind = "license", filename = "audit file.pdf", contentType = "application/pdf", bytes, upload = false, confirm = false, actor = ctx.owner } = {}) => {
    const n = audit.next();
    const data = bytes ?? fx.pdf(`fixture ${audit.runId} ${n}`);
    const res = await audit.step({
      group: G, name: `document-request#${n}`, fixture: true, actor, method: "POST", path: "/documents",
      body: { ownerType, ownerId, kind, filename, contentType, sizeBytes: data.byteLength }, expect: 201,
    });
    if (res.status !== 201) return undefined;
    const out = { document: res.body.document, uploadUrl: res.body.uploadUrl, bytes: data };
    if (upload) {
      await audit.step({
        group: G, name: `document-put#${n}`, fixture: true, method: "PUT", path: out.uploadUrl, absolute: true, origin: false,
        rawBody: data, headers: { "content-type": contentType }, expect: [200, 204],
      });
      if (confirm) {
        await audit.step({
          group: G, name: `document-confirm#${n}`, fixture: true, actor, method: "POST", path: `/documents/${out.document.id}/confirm`, expect: 200,
        });
      }
    }
    return out;
  };

  fx.signUp = async (group, name, actor, label, expect = 200) => {
    actor.email = audit.email(label);
    const res = await audit.step({
      group, name, actor, method: "POST", path: "/api/auth/sign-up/email",
      body: { name: `Audit ${label}`, email: actor.email, password: PASSWORD }, expect,
      basis: "app-contract", check: "200 with user and token; session cookie set",
      verify: (r) => (r.body?.user?.email === actor.email.toLowerCase() ? true : "user.email missing or different"),
    });
    actor.userId = res.body?.user?.id;
    return res;
  };

  return fx;
}

export { Actor, problemCode };
