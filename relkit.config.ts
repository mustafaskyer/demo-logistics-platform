/** Declares backend defaults; inspection remains disabled unless explicitly enabled. */
import { defineApp } from "relkit/config";
import env from "@app/platform/env.js";
import { localEvent, localRealtime } from "@relkit/local";
import { docker } from "@relkit/docker";
import { s3 } from "@relkit/s3";


export default defineApp({
  id: "relkit-logistics-14-nov",
  env,
  telemetry: { redaction: { mode: "development-redacted", maxBytes: 65_536 } },
  server: { port: 4100, maxBodyBytes: 1_048_576, apiDocs: { ui: "scalar" } },

  event: { "local": localEvent() },
  realtime: localRealtime(),
  defaults: { event: "local", bucket: "local", realtime: "default" },
  bucket: { "local": docker(s3()) },
  inspector: { enabled: true },
});
