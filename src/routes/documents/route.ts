/** Document collection: list a driver's or vehicle's files, and start an upload. */
import { defineRoute } from "relkit/routes";
import documents from "@app/services/documents/service.js";

export const GET = defineRoute({ target: documents.listDocuments });
export const POST = defineRoute({ target: documents.requestUpload, successStatus: 201 });
