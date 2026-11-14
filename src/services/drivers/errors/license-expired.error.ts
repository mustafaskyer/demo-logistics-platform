import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.license-expired",
  data: z.object({ licenseExpiresOn: z.string() }),
  message: ({ licenseExpiresOn }) => `License expired on ${licenseExpiresOn}`,
  http: { status: 422 },
  retry: "never",
});
