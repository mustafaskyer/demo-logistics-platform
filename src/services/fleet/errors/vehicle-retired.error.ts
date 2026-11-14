import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.vehicle-retired",
  data: z.object({ vehicleId: z.string() }),
  message: ({ vehicleId }) => `Vehicle ${vehicleId} is retired and cannot be modified`,
  http: { status: 409 },
  retry: "never",
});
