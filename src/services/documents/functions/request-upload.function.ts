/** Starts a document upload: records it as pending and returns a short-lived signed URL to PUT the file to. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import drivers from "@app/services/drivers/service.js";
import fleet from "@app/services/fleet/service.js";
import files from "@app/services/documents/buckets/files.bucket.js";
import ownerNotFound from "@app/services/documents/errors/owner-not-found.error.js";
import {
  contentTypes,
  documentKinds,
  documentSchema,
  maxDocumentBytes,
  objectKeyFor,
  ownerTypes,
  toDocument,
} from "@app/services/documents/schemas.js";

export default defineFunction({
  id: "documents.request-upload",
  access: { permissions: ["document:create"] },
  input: z.object({
    ownerType: z.enum(ownerTypes),
    ownerId: z.string().min(1),
    kind: z.enum(documentKinds),
    filename: z.string().trim().min(1).max(200),
    contentType: z.enum(contentTypes),
    sizeBytes: z.number().int().min(1).max(maxDocumentBytes),
  }),
  output: z.object({ document: documentSchema, uploadUrl: z.string() }),
  errors: [ownerNotFound],
  dependencies: {
    buckets: { files },
    functions: { getDriver: drivers.getDriver, getVehicle: fleet.getVehicle },
  },
  handler: async (input, context) => {
    const { organizationId, userId } = await currentTenant(context.auth);
    // The owning services decide whether the driver/vehicle exists in this company.
    const owner =
      input.ownerType === "driver"
        ? await context.functions.getDriver({ driverId: input.ownerId }).catch(() => null)
        : await context.functions.getVehicle({ vehicleId: input.ownerId }).catch(() => null);
    if (owner === null) return ownerNotFound.create({ ownerType: input.ownerType, ownerId: input.ownerId });

    const id = crypto.randomUUID();
    const objectKey = objectKeyFor(organizationId, input.ownerType, input.ownerId, id, input.filename);
    const row = await context.database.document.insert({
      data: {
        id,
        organizationId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        kind: input.kind,
        objectKey,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedBy: userId,
      },
    });
    // The signed URL carries the declared type and size, so the store refuses any other upload.
    const uploadUrl = await context.buckets.files.createWriteUrl(objectKey, {
      contentType: input.contentType,
      contentLength: input.sizeBytes,
    });
    return { document: toDocument(row), uploadUrl };
  },
});
