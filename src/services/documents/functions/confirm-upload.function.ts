/** Confirms a finished upload by checking the stored object, then marks the document as uploaded. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import files from "@app/services/documents/buckets/files.bucket.js";
import documentNotFound from "@app/services/documents/errors/document-not-found.error.js";
import uploadMissing from "@app/services/documents/errors/upload-missing.error.js";
import uploadSizeMismatch from "@app/services/documents/errors/upload-size-mismatch.error.js";
import { documentSchema, toDocument } from "@app/services/documents/schemas.js";

export default defineFunction({
  id: "documents.confirm-upload",
  access: { permissions: ["document:create"] },
  input: z.object({ documentId: z.string().min(1) }),
  output: documentSchema,
  errors: [documentNotFound, uploadMissing, uploadSizeMismatch],
  dependencies: { buckets: { files } },
  handler: async ({ documentId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const row = await context.database.document.findOne({ where: { id: documentId, organizationId } });
    if (row === null) return documentNotFound.create({ documentId });
    if (row.status === "uploaded") return toDocument(row);
    const stored = await context.buckets.files.head(row.objectKey);
    if (stored === undefined) return uploadMissing.create({ documentId });
    if (stored.size !== undefined && stored.size !== row.sizeBytes) {
      // A different size than declared means the client sent something else: discard it.
      await context.buckets.files.delete(row.objectKey);
      await context.database.document.delete({ where: { id: documentId, organizationId } });
      return uploadSizeMismatch.create({ expected: row.sizeBytes, actual: stored.size });
    }
    const updated = await context.database.document.update({
      where: { id: documentId, organizationId },
      data: { status: "uploaded" },
    });
    return updated === null ? documentNotFound.create({ documentId }) : toDocument(updated);
  },
});
