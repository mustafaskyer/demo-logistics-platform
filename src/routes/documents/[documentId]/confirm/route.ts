/** Confirms that the file was uploaded to the signed URL. */
import { defineRoute, http } from "relkit/routes";
import documents from "@app/services/documents/service.js";

export const POST = defineRoute({
  target: documents.confirmUpload,
  request: http.input({ documentId: http.path("documentId") }),
});
