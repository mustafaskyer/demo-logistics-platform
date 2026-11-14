import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.driver-already-assigned",
  data: z.object({ driverId: z.string() }),
  message: ({ driverId }) => `Driver ${driverId} already has a vehicle`,
  http: { status: 409 },
  retry: "never",
});
