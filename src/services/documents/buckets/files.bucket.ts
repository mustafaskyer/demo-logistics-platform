import { defineBucket } from "relkit/buckets";

/** Private storage for driver and vehicle paperwork; objects are reached only through signed URLs. */
const files = defineBucket({
  id: "documents.files",
  profile: "local",
  visibility: "private",
  maxObjectBytes: 5_000_000,
  allowedContentTypes: ["application/pdf", "image/jpeg", "image/png"],
});

export default files;
