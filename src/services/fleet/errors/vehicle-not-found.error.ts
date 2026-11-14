import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.vehicle-not-found",
  data: z.object({ vehicleId: z.string() }),
  message: ({ vehicleId }) => `Vehicle ${vehicleId} was not found`,
  http: { status: 404 },
  retry: "never",
});
