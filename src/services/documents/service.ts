/** Documents boundary: driver and vehicle paperwork stored in the private `documents.files` bucket. */
import { defineService } from "relkit/services";
import confirmUpload from "@app/services/documents/functions/confirm-upload.function.js";
import deleteDocument from "@app/services/documents/functions/delete-document.function.js";
import getDownloadUrl from "@app/services/documents/functions/get-download-url.function.js";
import listDocuments from "@app/services/documents/functions/list-documents.function.js";
import requestUpload from "@app/services/documents/functions/request-upload.function.js";

export default defineService({
  id: "documents",
  functions: { requestUpload, confirmUpload, listDocuments, getDownloadUrl, deleteDocument },
});
