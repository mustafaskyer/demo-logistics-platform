// Group "lifecycle": full business sequences as owner, with every declared error.
import { problemCode, all, bodyMatches, hasKeys, sleep } from "./lib.mjs";

export async function lifecycleGroup(audit, ctx, fx) {
  const G = "lifecycle";
  const s = (o) => audit.step({ group: G, actor: ctx.owner, ...o });
  const code = problemCode;
  const bModel = await fx.model({}, ctx.ownerB);
  const bVehicle = await fx.vehicle(bModel?.id, {}, ctx.ownerB);
  ctx.foreignVehicleId = bVehicle?.id;

  // ---------------------------------------------------------------- vehicle models
  const mName = audit.modelName("LM");
  const m1 = await s({ name: "models/create", method: "POST", path: "/vehicle-models", body: { make: " Isuzu ", name: mName, bodyType: "box_truck", capacityKg: 3500 }, expect: 201,
    check: "201; make trimmed; no organizationId in body", verify: all(bodyMatches({ make: "Isuzu", name: mName, bodyType: "box_truck", capacityKg: 3500 }), (r) => ("organizationId" in r.body ? "tenant id leaked" : true)) });
  const model = m1.body;
  await s({ name: "models/create-duplicate", method: "POST", path: "/vehicle-models", body: { make: "Isuzu", name: mName, bodyType: "van", capacityKg: 1 }, expect: 409, verify: code("fleet.model-exists") });
  await s({ name: "models/create-case-variant", method: "POST", path: "/vehicle-models", body: { make: "isuzu", name: mName, bodyType: "van", capacityKg: 1 }, expect: 201, basis: "app-contract",
    note: "uniqueness is case-sensitive in the app (only trimmed); the second model must be accepted. Recorded for visibility, not a framework matter." });
  const other = await fx.model();
  await s({ name: "models/list", method: "GET", path: "/vehicle-models?limit=100", expect: 200, check: "contains created model, limit/offset echoed", verify: all((r) => (r.body.items.some((i) => i.id === model?.id) ? true : "created model missing"), bodyMatches({ limit: 100, offset: 0 })) });
  await s({ name: "models/list-page-size-2", method: "GET", path: "/vehicle-models?limit=2&offset=0", expect: 200, verify: (r) => (r.body.items.length === 2 && r.body.limit === 2 ? true : `items=${r.body.items?.length}`) });
  await s({ name: "models/list-offset-beyond-end", method: "GET", path: "/vehicle-models?limit=10&offset=100000", expect: 200, verify: (r) => (r.body.items.length === 0 ? true : "items not empty") });
  await s({ name: "models/update", method: "PATCH", path: `/vehicle-models/${model?.id}`, body: { capacityKg: 4200 }, expect: 200, verify: all(bodyMatches({ capacityKg: 4200 }), (r) => (r.body.updatedAt >= model.updatedAt ? true : "updatedAt went backwards")) });
  await s({ name: "models/update-empty-patch", method: "PATCH", path: `/vehicle-models/${model?.id}`, body: {}, expect: 200, basis: "app-contract", note: "every field optional; an empty patch only touches updatedAt" });
  await s({ name: "models/update-clash", method: "PATCH", path: `/vehicle-models/${model?.id}`, body: { name: other?.name, make: other?.make }, expect: 409, verify: code("fleet.model-exists") });
  await s({ name: "models/update-unknown", method: "PATCH", path: "/vehicle-models/does-not-exist", body: { capacityKg: 1 }, expect: 404, verify: code("fleet.model-not-found") });
  await s({ name: "models/delete-unknown", method: "DELETE", path: "/vehicle-models/does-not-exist", expect: 404, verify: code("fleet.model-not-found") });
  const v1 = await fx.vehicle(model?.id, { vin: audit.vin() });
  await s({ name: "models/delete-in-use", method: "DELETE", path: `/vehicle-models/${model?.id}`, expect: 409, check: "fleet.model-in-use with data.vehicles = 1", verify: all(code("fleet.model-in-use"), (r) => (r.body?.data?.vehicles === 1 ? true : `data=${JSON.stringify(r.body?.data)}`)) });
  await s({ name: "models/delete-unused", method: "DELETE", path: `/vehicle-models/${other?.id}`, expect: 200, verify: bodyMatches({ deleted: true }) });
  await s({ name: "models/delete-again", method: "DELETE", path: `/vehicle-models/${other?.id}`, expect: 404, verify: code("fleet.model-not-found") });

  // ---------------------------------------------------------------- vehicles
  const plate = audit.plate();
  const vin = audit.vin();
  const lowerPlate = plate.toLowerCase().replace(" ", "   ");
  const veh = await s({ name: "vehicles/create", method: "POST", path: "/vehicles", body: { modelId: model?.id, plate: lowerPlate, vin: vin.toLowerCase(), year: 2021 }, expect: 201,
    check: "plate upper-cased with single spaces, VIN upper-cased, status active", verify: all(bodyMatches({ plate, vin, status: "active", year: 2021, modelId: model?.id }), hasKeys("id", "createdAt", "updatedAt")) });
  const vehicle = veh.body;
  await s({ name: "vehicles/get", method: "GET", path: `/vehicles/${vehicle?.id}`, expect: 200, verify: bodyMatches({ id: vehicle?.id, plate }) });
  await s({ name: "vehicles/get-unknown", method: "GET", path: "/vehicles/does-not-exist", expect: 404, verify: code("fleet.vehicle-not-found") });
  await s({ name: "vehicles/create-plate-taken", method: "POST", path: "/vehicles", body: { modelId: model?.id, plate: plate.toLowerCase(), year: 2021 }, expect: 409, verify: code("fleet.plate-taken") });
  await s({ name: "vehicles/create-vin-taken", method: "POST", path: "/vehicles", body: { modelId: model?.id, plate: audit.plate(), vin, year: 2021 }, expect: 409, verify: code("fleet.vin-taken") });
  await s({ name: "vehicles/create-model-not-found", method: "POST", path: "/vehicles", body: { modelId: "does-not-exist", plate: audit.plate(), year: 2021 }, expect: 404, verify: code("fleet.model-not-found") });
  await s({ name: "vehicles/create-invalid-vin", method: "POST", path: "/vehicles", body: { modelId: model?.id, plate: audit.plate(), vin: "TOO-SHORT", year: 2021 }, expect: 422, verify: code("validation") });
  await s({ name: "vehicles/create-without-vin-twice-1", method: "POST", path: "/vehicles", body: { modelId: model?.id, plate: audit.plate(), year: 2021 }, expect: 201, verify: bodyMatches({ vin: null }) });
  await s({ name: "vehicles/create-without-vin-twice-2", method: "POST", path: "/vehicles", body: { modelId: model?.id, plate: audit.plate(), year: 2021 }, expect: 201, verify: bodyMatches({ vin: null }) });
  const vb = await fx.vehicle(model?.id);
  const newPlate = audit.plate();
  await s({ name: "vehicles/update", method: "PATCH", path: `/vehicles/${vehicle?.id}`, body: { plate: newPlate.toLowerCase(), year: 2023 }, expect: 200, verify: bodyMatches({ plate: newPlate, year: 2023 }) });
  await s({ name: "vehicles/update-plate-taken", method: "PATCH", path: `/vehicles/${vehicle?.id}`, body: { plate: vb?.plate }, expect: 409, verify: code("fleet.plate-taken") });
  await s({ name: "vehicles/update-vin-taken", method: "PATCH", path: `/vehicles/${vb?.id}`, body: { vin }, expect: 409, verify: code("fleet.vin-taken") });
  await s({ name: "vehicles/update-model-not-found", method: "PATCH", path: `/vehicles/${vehicle?.id}`, body: { modelId: "does-not-exist" }, expect: 404, verify: code("fleet.model-not-found") });
  await s({ name: "vehicles/update-unknown", method: "PATCH", path: "/vehicles/does-not-exist", body: { year: 2020 }, expect: 404, verify: code("fleet.vehicle-not-found") });
  await s({ name: "vehicles/update-same-plate", method: "PATCH", path: `/vehicles/${vehicle?.id}`, body: { plate: newPlate }, expect: 200, note: "own plate is not a clash" });
  await s({ name: "vehicles/status-maintenance", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "maintenance" }, expect: 200, verify: bodyMatches({ status: "maintenance" }) });
  await s({ name: "vehicles/status-maintenance-again", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "maintenance" }, expect: 409, verify: code("fleet.invalid-status-transition") });
  await s({ name: "vehicles/status-active", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "active" }, expect: 200, verify: bodyMatches({ status: "active" }) });
  await s({ name: "vehicles/status-retired-via-status-endpoint", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "retired" }, expect: 422, verify: code("validation") });
  await s({ name: "vehicles/status-unknown", method: "PUT", path: "/vehicles/does-not-exist/status", body: { status: "maintenance" }, expect: 404, verify: code("fleet.vehicle-not-found") });
  await s({ name: "vehicles/list-filter-status", method: "GET", path: "/vehicles?status=maintenance&limit=100", expect: 200, verify: (r) => (r.body.items.every((i) => i.status === "maintenance") ? true : "filter returned other statuses") });
  await s({ name: "vehicles/list-filter-model", method: "GET", path: `/vehicles?modelId=${model?.id}&limit=100`, expect: 200, verify: (r) => (r.body.items.length >= 4 && r.body.items.every((i) => i.modelId === model?.id) ? true : `items=${r.body.items?.length}`) });
  await s({ name: "vehicles/retire", method: "POST", path: `/vehicles/${vehicle?.id}/retire`, expect: 200, verify: bodyMatches({ status: "retired" }) });
  await s({ name: "vehicles/retire-again", method: "POST", path: `/vehicles/${vehicle?.id}/retire`, expect: 409, verify: code("fleet.invalid-status-transition") });
  await s({ name: "vehicles/status-after-retire", method: "PUT", path: `/vehicles/${vehicle?.id}/status`, body: { status: "active" }, expect: 409, verify: code("fleet.invalid-status-transition") });
  await s({ name: "vehicles/update-after-retire", method: "PATCH", path: `/vehicles/${vehicle?.id}`, body: { year: 2020 }, expect: 409, verify: code("fleet.vehicle-retired") });
  await s({ name: "vehicles/get-after-retire", method: "GET", path: `/vehicles/${vehicle?.id}`, expect: 200, verify: bodyMatches({ status: "retired" }) });
  await s({ name: "vehicles/retire-unknown", method: "POST", path: "/vehicles/does-not-exist/retire", expect: 404, verify: code("fleet.vehicle-not-found") });
  await s({ name: "models/delete-with-retired-vehicle", method: "DELETE", path: `/vehicle-models/${model?.id}`, expect: 409, verify: code("fleet.model-in-use"), note: "retired vehicles still reference the model" });
  void v1;

  // ---------------------------------------------------------------- drivers
  const lic = audit.license();
  const d1 = await s({ name: "drivers/create", method: "POST", path: "/drivers", body: { fullName: "  Ali Hassan ", phone: "+201001234567", licenseNumber: lic.toLowerCase(), licenseClass: "c", licenseExpiresOn: "2099-01-01" }, expect: 201,
    check: "licence and class upper-cased, name trimmed, status active, userId null", verify: all(bodyMatches({ licenseNumber: lic, licenseClass: "C", status: "active", userId: null, fullName: "Ali Hassan" }), (r) => ("organizationId" in r.body ? "tenant id leaked" : true)) });
  const driver = d1.body;
  await s({ name: "drivers/create-license-expired", method: "POST", path: "/drivers", body: { fullName: "Old Licence", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2020-01-01" }, expect: 422, verify: code("drivers.license-expired") });
  await s({ name: "drivers/create-license-taken", method: "POST", path: "/drivers", body: { fullName: "Dup Licence", phone: "+201001234567", licenseNumber: lic.toLowerCase(), licenseClass: "B", licenseExpiresOn: "2099-01-01" }, expect: 409, verify: code("drivers.license-taken") });
  await s({ name: "drivers/create-user-not-in-company", method: "POST", path: "/drivers", body: { fullName: "Foreign User", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2099-01-01", userId: ctx.ownerB.userId }, expect: 422, verify: code("drivers.user-not-in-company") });
  await s({ name: "drivers/create-user-unknown", method: "POST", path: "/drivers", body: { fullName: "Ghost User", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2099-01-01", userId: "ghost" }, expect: 422, verify: code("drivers.user-not-in-company") });
  const linked = await s({ name: "drivers/create-linked-to-member", method: "POST", path: "/drivers", body: { fullName: "Linked Driver", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2099-01-01", userId: ctx.driver.userId }, expect: 201, verify: bodyMatches({ userId: ctx.driver.userId }) });
  void linked;
  await s({ name: "drivers/create-user-already-driver", method: "POST", path: "/drivers", body: { fullName: "Second Profile", phone: "+201001234567", licenseNumber: audit.license(), licenseClass: "B", licenseExpiresOn: "2099-01-01", userId: ctx.driver.userId }, expect: 409, verify: code("drivers.user-already-driver") });
  await s({ name: "drivers/get", method: "GET", path: `/drivers/${driver?.id}`, expect: 200, verify: bodyMatches({ id: driver?.id }) });
  await s({ name: "drivers/get-unknown", method: "GET", path: "/drivers/does-not-exist", expect: 404, verify: code("drivers.driver-not-found") });
  await s({ name: "drivers/update", method: "PATCH", path: `/drivers/${driver?.id}`, body: { fullName: "Updated Name", licenseClass: "d", phone: "+20 100 123 4567" }, expect: 200, verify: bodyMatches({ fullName: "Updated Name", licenseClass: "D" }) });
  const d2 = await fx.driver();
  await s({ name: "drivers/update-license-taken", method: "PATCH", path: `/drivers/${driver?.id}`, body: { licenseNumber: d2?.licenseNumber }, expect: 409, verify: code("drivers.license-taken") });
  await s({ name: "drivers/update-license-expired", method: "PATCH", path: `/drivers/${driver?.id}`, body: { licenseExpiresOn: "2001-01-01" }, expect: 422, verify: code("drivers.license-expired") });
  await s({ name: "drivers/update-unknown", method: "PATCH", path: "/drivers/does-not-exist", body: { fullName: "Nobody Here" }, expect: 404, verify: code("drivers.driver-not-found") });
  await s({ name: "drivers/list", method: "GET", path: "/drivers?limit=100", expect: 200, verify: (r) => (r.body.items.some((i) => i.id === driver?.id) ? true : "driver missing") });
  await s({ name: "drivers/deactivate", method: "POST", path: `/drivers/${driver?.id}/deactivate`, expect: 200, verify: bodyMatches({ status: "inactive" }) });
  await s({ name: "drivers/deactivate-again", method: "POST", path: `/drivers/${driver?.id}/deactivate`, expect: 200, note: "idempotent in the app" });
  await s({ name: "drivers/list-inactive", method: "GET", path: "/drivers?status=inactive&limit=100", expect: 200, verify: (r) => (r.body.items.some((i) => i.id === driver?.id) && r.body.items.every((i) => i.status === "inactive") ? true : "filter") });
  await s({ name: "drivers/deactivate-unknown", method: "POST", path: "/drivers/does-not-exist/deactivate", expect: 404, verify: code("drivers.driver-not-found") });
  await s({ name: "drivers/activate", method: "POST", path: `/drivers/${driver?.id}/activate`, expect: 200, verify: bodyMatches({ status: "active" }) });
  await s({ name: "drivers/activate-unknown", method: "POST", path: "/drivers/does-not-exist/activate", expect: 404, verify: code("drivers.driver-not-found") });

  // ---------------------------------------------------------------- assignments
  const aDriver = await fx.driver();
  const aDriver2 = await fx.driver();
  const aVeh = await fx.vehicle(model?.id);
  const aVeh2 = await fx.vehicle(model?.id);
  const asg = await s({ name: "assignments/create", method: "POST", path: "/driver-assignments", body: { driverId: aDriver?.id, vehicleId: aVeh?.id }, expect: 201, verify: all(bodyMatches({ driverId: aDriver?.id, vehicleId: aVeh?.id, unassignedAt: null }), hasKeys("id", "assignedAt")) });
  await s({ name: "assignments/list-open", method: "GET", path: "/driver-assignments", expect: 200, verify: (r) => (r.body.items.some((i) => i.id === asg.body?.id) && r.body.items.every((i) => i.unassignedAt === null) ? true : "open list wrong") });
  await s({ name: "assignments/driver-already-assigned", method: "POST", path: "/driver-assignments", body: { driverId: aDriver?.id, vehicleId: aVeh2?.id }, expect: 409, verify: code("drivers.driver-already-assigned") });
  await s({ name: "assignments/vehicle-already-assigned", method: "POST", path: "/driver-assignments", body: { driverId: aDriver2?.id, vehicleId: aVeh?.id }, expect: 409, verify: code("drivers.vehicle-already-assigned") });
  const inactive = await fx.driver();
  await s({ name: "assignments/setup-deactivate", method: "POST", path: `/drivers/${inactive?.id}/deactivate`, expect: 200, fixture: true });
  await s({ name: "assignments/driver-inactive", method: "POST", path: "/driver-assignments", body: { driverId: inactive?.id, vehicleId: aVeh2?.id }, expect: 409, verify: code("drivers.driver-inactive") });
  const mVeh = await fx.vehicle(model?.id);
  await s({ name: "assignments/setup-maintenance", method: "PUT", path: `/vehicles/${mVeh?.id}/status`, body: { status: "maintenance" }, expect: 200, fixture: true });
  await s({ name: "assignments/vehicle-in-maintenance", method: "POST", path: "/driver-assignments", body: { driverId: aDriver2?.id, vehicleId: mVeh?.id }, expect: 409, verify: code("drivers.vehicle-unavailable") });
  await s({ name: "assignments/vehicle-unknown", method: "POST", path: "/driver-assignments", body: { driverId: aDriver2?.id, vehicleId: "does-not-exist" }, expect: 409, verify: code("drivers.vehicle-unavailable") });
  await s({ name: "assignments/driver-unknown", method: "POST", path: "/driver-assignments", body: { driverId: "does-not-exist", vehicleId: aVeh2?.id }, expect: 404, verify: code("drivers.driver-not-found") });
  await s({ name: "assignments/foreign-vehicle", method: "POST", path: "/driver-assignments", body: { driverId: aDriver2?.id, vehicleId: ctx.foreignVehicleId ?? "foreign" }, expect: 409, verify: code("drivers.vehicle-unavailable"), note: "a company-B vehicle id must look nonexistent" });
  await s({ name: "assignments/unassign", method: "DELETE", path: `/drivers/${aDriver?.id}/vehicle`, expect: 200, verify: (r) => (r.body?.unassignedAt ? true : "unassignedAt null") });
  await s({ name: "assignments/unassign-again", method: "DELETE", path: `/drivers/${aDriver?.id}/vehicle`, expect: 404, verify: code("drivers.no-open-assignment") });
  await s({ name: "assignments/unassign-unknown-driver", method: "DELETE", path: "/drivers/does-not-exist/vehicle", expect: 404, verify: code("drivers.no-open-assignment"), note: "no driver-not-found distinction here" });
  await s({ name: "assignments/history", method: "GET", path: "/driver-assignments?includeClosed=true", expect: 200, verify: (r) => (r.body.items.some((i) => i.id === asg.body?.id && i.unassignedAt) ? true : "closed assignment missing from history") });
  await s({ name: "assignments/open-list-excludes-closed", method: "GET", path: "/driver-assignments?includeClosed=false", expect: 200, verify: (r) => (r.body.items.some((i) => i.id === asg.body?.id) ? "closed assignment still listed" : true) });
  await s({ name: "assignments/reassign-freed-vehicle", method: "POST", path: "/driver-assignments", body: { driverId: aDriver2?.id, vehicleId: aVeh?.id }, expect: 201 });
  await s({ name: "assignments/deactivate-releases-vehicle", method: "POST", path: `/drivers/${aDriver2?.id}/deactivate`, expect: 200, fixture: false });
  await s({ name: "assignments/after-deactivate-open-list", method: "GET", path: "/driver-assignments", expect: 200, verify: (r) => (r.body.items.some((i) => i.driverId === aDriver2?.id) ? "driver still holds a vehicle after deactivation" : true) });

  // ---------------------------------------------------------------- documents
  const docDriver = await fx.driver();
  const docVeh = await fx.vehicle(model?.id);
  const bytes = fx.pdf(`lifecycle ${audit.runId}`);
  const req = await s({ name: "documents/request-upload", method: "POST", path: "/documents", body: { ownerType: "driver", ownerId: docDriver?.id, kind: "license", filename: "licence front.pdf", contentType: "application/pdf", sizeBytes: bytes.byteLength }, expect: 201,
    check: "document pending, no objectKey/organizationId; uploadUrl present", verify: all((r) => (r.body?.document?.status === "pending" ? true : "status not pending"), (r) => ("objectKey" in r.body.document || "organizationId" in r.body.document ? "storage key or tenant id leaked" : true), (r) => (typeof r.body?.uploadUrl === "string" ? true : "uploadUrl missing")) });
  const doc = req.body?.document;
  const uploadUrl = req.body?.uploadUrl;
  await s({ name: "documents/list-excludes-pending", method: "GET", path: `/documents?ownerType=driver&ownerId=${docDriver?.id}`, expect: 200, verify: (r) => (r.body.items.some((i) => i.id === doc?.id) ? "pending document listed" : true) });
  await s({ name: "documents/download-not-ready", method: "GET", path: `/documents/${doc?.id}/download`, expect: 409, verify: code("documents.document-not-ready") });
  await s({ name: "documents/confirm-upload-missing", method: "POST", path: `/documents/${doc?.id}/confirm`, expect: 409, verify: code("documents.upload-missing") });
  await s({ name: "documents/put-bytes-to-signed-url", method: "PUT", path: uploadUrl ?? "http://invalid.invalid/", absolute: true, origin: false, rawBody: bytes, headers: { "content-type": "application/pdf" }, expect: [200, 204], basis: "relkit-docs", note: "README: PUT the file to uploadUrl" });
  await s({ name: "documents/confirm", method: "POST", path: `/documents/${doc?.id}/confirm`, expect: 200, verify: bodyMatches({ status: "uploaded" }) });
  await s({ name: "documents/confirm-twice", method: "POST", path: `/documents/${doc?.id}/confirm`, expect: 200, verify: bodyMatches({ status: "uploaded" }) });
  await s({ name: "documents/list", method: "GET", path: `/documents?ownerType=driver&ownerId=${docDriver?.id}`, expect: 200, verify: (r) => (r.body.items.some((i) => i.id === doc?.id && i.filename === "licence front.pdf") ? true : "uploaded document not listed") });
  const dl = await s({ name: "documents/download", method: "GET", path: `/documents/${doc?.id}/download`, expect: 200, verify: all(bodyMatches({ filename: "licence front.pdf", contentType: "application/pdf" }), (r) => (typeof r.body.url === "string" ? true : "url missing")) });
  if (dl.body?.url) {
    await s({ name: "documents/fetch-signed-download-url", method: "GET", path: dl.body.url, absolute: true, origin: false, expect: 200, basis: "relkit-docs",
      check: "bytes equal the uploaded bytes", verify: (r) => (r.text === new TextDecoder().decode(bytes) ? true : `downloaded ${r.bytes.byteLength} bytes, content differs from upload`) });
  }
  const dReq = await s({ name: "documents/vehicle-owner-request", method: "POST", path: "/documents", body: { ownerType: "vehicle", ownerId: docVeh?.id, kind: "insurance", filename: "ins.pdf", contentType: "application/pdf", sizeBytes: bytes.byteLength }, expect: 201 });
  await s({ name: "documents/vehicle-owner-put", method: "PUT", path: dReq.body?.uploadUrl ?? "http://invalid.invalid/", absolute: true, origin: false, rawBody: bytes, headers: { "content-type": "application/pdf" }, expect: [200, 204] });
  await s({ name: "documents/vehicle-owner-confirm", method: "POST", path: `/documents/${dReq.body?.document?.id}/confirm`, expect: 200 });
  await s({ name: "documents/vehicle-owner-list", method: "GET", path: `/documents?ownerType=vehicle&ownerId=${docVeh?.id}`, expect: 200, verify: (r) => (r.body.items.length === 1 && r.body.items[0].kind === "insurance" ? true : `items=${r.body.items?.length}`) });
  await s({ name: "documents/delete", method: "DELETE", path: `/documents/${doc?.id}`, expect: 200, verify: bodyMatches({ deleted: true }) });
  await s({ name: "documents/download-after-delete", method: "GET", path: `/documents/${doc?.id}/download`, expect: 404, verify: code("documents.document-not-found") });
  if (dl.body?.url) {
    await s({ name: "documents/signed-url-after-delete", method: "GET", path: dl.body.url, absolute: true, origin: false, expect: [403, 404], basis: "http-norm", note: "the stored object is removed by delete; the old signed read URL must stop working" });
  }
  await s({ name: "documents/delete-again", method: "DELETE", path: `/documents/${doc?.id}`, expect: 404, verify: code("documents.document-not-found") });
  await s({ name: "documents/delete-unknown", method: "DELETE", path: "/documents/does-not-exist", expect: 404, verify: code("documents.document-not-found") });
  await s({ name: "documents/confirm-unknown", method: "POST", path: "/documents/does-not-exist/confirm", expect: 404, verify: code("documents.document-not-found") });
  await s({ name: "documents/download-unknown", method: "GET", path: "/documents/does-not-exist/download", expect: 404, verify: code("documents.document-not-found") });
  await s({ name: "documents/owner-not-found", method: "POST", path: "/documents", body: { ownerType: "driver", ownerId: "does-not-exist", kind: "license", filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10 }, expect: 404, verify: code("documents.owner-not-found") });
  await s({ name: "documents/owner-vehicle-not-found", method: "POST", path: "/documents", body: { ownerType: "vehicle", ownerId: "does-not-exist", kind: "license", filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10 }, expect: 404, verify: code("documents.owner-not-found") });

  // size mismatch: declared 10, uploaded more -> confirm discards
  const mm = await s({ name: "documents/size-mismatch-request", method: "POST", path: "/documents", body: { ownerType: "driver", ownerId: docDriver?.id, kind: "other", filename: "big.pdf", contentType: "application/pdf", sizeBytes: 10 }, expect: 201 });
  await s({ name: "documents/size-mismatch-put", method: "PUT", path: mm.body?.uploadUrl ?? "http://invalid.invalid/", absolute: true, origin: false, rawBody: fx.pdf("this is much longer than ten bytes"), headers: { "content-type": "application/pdf" }, expect: [200, 204] });
  await s({ name: "documents/size-mismatch-confirm", method: "POST", path: `/documents/${mm.body?.document?.id}/confirm`, expect: 422, verify: code("documents.upload-size-mismatch") });
  await s({ name: "documents/size-mismatch-confirm-again", method: "POST", path: `/documents/${mm.body?.document?.id}/confirm`, expect: 404, verify: code("documents.document-not-found"), note: "mismatch discards the row" });

  // wrong content type on the signed upload
  const ct = await s({ name: "documents/wrong-content-type-request", method: "POST", path: "/documents", body: { ownerType: "driver", ownerId: docDriver?.id, kind: "other", filename: "pic.png", contentType: "image/png", sizeBytes: bytes.byteLength }, expect: 201 });
  const ctPut = await s({ name: "documents/wrong-content-type-put", method: "PUT", path: ct.body?.uploadUrl ?? "http://invalid.invalid/", absolute: true, origin: false, rawBody: bytes, headers: { "content-type": "application/x-msdownload" }, expect: [400, 403, 415], basis: "relkit-docs",
    note: "declared image/png, PUT as application/x-msdownload; bucket allows only pdf/jpeg/png. A 2xx means the signed URL does not bind the content type" });
  if (ctPut.status >= 200 && ctPut.status < 300) {
    await s({ name: "documents/wrong-content-type-confirm", method: "POST", path: `/documents/${ct.body?.document?.id}/confirm`, expect: [409, 422], basis: "relkit-docs", check: "document must not become 'uploaded' with a content type the bucket forbids", note: "recorded because the PUT was accepted" });
    const ctDl = await s({ name: "documents/wrong-content-type-download", method: "GET", path: `/documents/${ct.body?.document?.id}/download`, expect: 200, fixture: false });
    if (ctDl.body?.url) {
      await s({ name: "documents/wrong-content-type-served-as", method: "GET", path: ctDl.body.url, absolute: true, origin: false, expect: 200, basis: "relkit-docs",
        check: "the stored object is served with the declared content type image/png (not the type the client PUT)", verify: (r) => (r.headers["content-type"] === "image/png" ? true : `served as ${r.headers["content-type"]}`) });
    }
  }

  // over 5 MB
  await s({ name: "documents/over-5mb-declared", method: "POST", path: "/documents", body: { ownerType: "driver", ownerId: docDriver?.id, kind: "other", filename: "huge.pdf", contentType: "application/pdf", sizeBytes: 5_000_001 }, expect: 422, verify: code("validation") });
  const big = await s({ name: "documents/over-5mb-request-small", method: "POST", path: "/documents", body: { ownerType: "driver", ownerId: docDriver?.id, kind: "other", filename: "sneaky.pdf", contentType: "application/pdf", sizeBytes: 1000 }, expect: 201 });
  const bigBytes = new Uint8Array(5_000_001).fill(37);
  const bigPut = await s({ name: "documents/over-5mb-put-to-small-declaration", method: "PUT", path: big.body?.uploadUrl ?? "http://invalid.invalid/", absolute: true, origin: false, rawBody: bigBytes, headers: { "content-type": "application/pdf" }, expect: [400, 403, 413], basis: "relkit-docs",
    note: "bucket maxObjectBytes is 5_000_000; a 5_000_001 byte PUT should be refused by the storage layer. 2xx means the cap is enforced only at confirm (size mismatch) or not at all" });
  if (bigPut.status >= 200 && bigPut.status < 300) {
    await s({ name: "documents/over-5mb-confirm", method: "POST", path: `/documents/${big.body?.document?.id}/confirm`, expect: 422, verify: code("documents.upload-size-mismatch"), basis: "app-contract", note: "oversized object stored by the bucket; confirm must discard it" });
  }
  await sleep(0);
}
