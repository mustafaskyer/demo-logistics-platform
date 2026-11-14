import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "documents.document-not-ready",
  data: z.object({ documentId: z.string() }),
  message: ({ documentId }) => `Document ${documentId} has not finished uploading`,
  http: { status: 409 },
  retry: "never",
});
