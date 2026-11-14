import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.vehicle-unavailable",
  data: z.object({ vehicleId: z.string() }),
  message: ({ vehicleId }) => `Vehicle ${vehicleId} does not exist or is not active`,
  http: { status: 409 },
  retry: "never",
});
