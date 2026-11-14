/** Returns a signed download URL. */
import { defineRoute, http } from "relkit/routes";
import documents from "@app/services/documents/service.js";

export const GET = defineRoute({
  target: documents.getDownloadUrl,
  request: http.input({ documentId: http.path("documentId") }),
});
