import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.vin-taken",
  data: z.object({ vin: z.string() }),
  message: ({ vin }) => `VIN ${vin} is already registered`,
  http: { status: 409 },
  retry: "never",
});
