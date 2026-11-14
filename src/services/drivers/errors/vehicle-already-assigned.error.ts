import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.vehicle-already-assigned",
  data: z.object({ vehicleId: z.string() }),
  message: ({ vehicleId }) => `Vehicle ${vehicleId} already has a driver`,
  http: { status: 409 },
  retry: "never",
});
