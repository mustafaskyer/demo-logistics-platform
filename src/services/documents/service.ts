/** Documents boundary: driver and vehicle paperwork stored in the private `documents.files` bucket. */
import { defineService } from "relkit/services";
import confirmUpload from "@app/services/documents/functions/confirm-upload.function.js";
import requestUpload from "@app/services/documents/functions/request-upload.function.js";

export default defineService({
  id: "documents",
  functions: { requestUpload, confirmUpload },
});
