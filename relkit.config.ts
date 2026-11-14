/** Declares backend defaults; inspection remains disabled unless explicitly enabled. */
import { defineApp } from "relkit/config";
import env from "@app/platform/env.js";


export default defineApp({
  id: "relkit-logistics-14-nov",
  env,
  telemetry: { redaction: { mode: "development-redacted", maxBytes: 65_536 } },
  server: { port: 3000, maxBodyBytes: 1_048_576, apiDocs: { ui: "scalar" } },

});
