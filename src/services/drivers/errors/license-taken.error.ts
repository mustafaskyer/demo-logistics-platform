import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.license-taken",
  data: z.object({ licenseNumber: z.string() }),
  message: ({ licenseNumber }) => `License ${licenseNumber} is already registered`,
  http: { status: 409 },
  retry: "never",
});
