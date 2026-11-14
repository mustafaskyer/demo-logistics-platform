import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "documents.upload-missing",
  data: z.object({ documentId: z.string() }),
  message: ({ documentId }) => `No file has been uploaded for document ${documentId}`,
  http: { status: 409 },
  retry: "never",
});
