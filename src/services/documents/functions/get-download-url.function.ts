/** Returns a short-lived signed URL to download an uploaded document. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { currentTenant } from "@app/platform/tenant.js";
import files from "@app/services/documents/buckets/files.bucket.js";
import documentNotFound from "@app/services/documents/errors/document-not-found.error.js";
import documentNotReady from "@app/services/documents/errors/document-not-ready.error.js";

export default defineFunction({
  id: "documents.get-download-url",
  access: { permissions: ["document:read"] },
  input: z.object({ documentId: text().min(1) }),
  output: z.object({ url: z.string(), filename: z.string(), contentType: z.string() }),
  errors: [documentNotFound, documentNotReady],
  dependencies: { buckets: { files } },
  handler: async ({ documentId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const row = await context.database.document.findOne({ where: { id: documentId, organizationId } });
    if (row === null) return documentNotFound.create({ documentId });
    if (row.status !== "uploaded") return documentNotReady.create({ documentId });
    return {
      url: await context.buckets.files.createReadUrl(row.objectKey),
      filename: row.filename,
      contentType: row.contentType,
    };
  },
});
