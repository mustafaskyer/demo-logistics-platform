/** Document collection: start an upload. */
import { defineRoute } from "relkit/routes";
import documents from "@app/services/documents/service.js";

export const POST = defineRoute({ target: documents.requestUpload, successStatus: 201 });
