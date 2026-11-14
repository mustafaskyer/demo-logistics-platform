import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "documents.document-not-found",
  data: z.object({ documentId: z.string() }),
  message: ({ documentId }) => `Document ${documentId} was not found`,
  http: { status: 404 },
  retry: "never",
});
