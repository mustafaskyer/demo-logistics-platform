/** One document: delete. */
import { defineRoute, http } from "relkit/routes";
import documents from "@app/services/documents/service.js";

export const DELETE = defineRoute({
  target: documents.deleteDocument,
  request: http.input({ documentId: http.path("documentId") }),
});
