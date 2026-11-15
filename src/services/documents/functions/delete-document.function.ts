/** Deletes a document and its stored file. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { currentTenant } from "@app/platform/tenant.js";
import files from "@app/services/documents/buckets/files.bucket.js";
import documentNotFound from "@app/services/documents/errors/document-not-found.error.js";

export default defineFunction({
  id: "documents.delete-document",
  access: { permissions: ["document:delete"] },
  input: z.object({ documentId: text().min(1) }),
  output: z.object({ deleted: z.literal(true) }),
  errors: [documentNotFound],
  dependencies: { buckets: { files } },
  handler: async ({ documentId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const row = await context.database.document.findOne({ where: { id: documentId, organizationId } });
    if (row === null) return documentNotFound.create({ documentId });
    // Remove the row first: a leftover object is harmless, a row pointing at no object is not.
    await context.database.document.delete({ where: { id: documentId, organizationId } });
    await context.buckets.files.delete(row.objectKey);
    return { deleted: true as const };
  },
});
