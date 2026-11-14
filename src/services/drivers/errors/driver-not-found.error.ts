import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.driver-not-found",
  data: z.object({ driverId: z.string() }),
  message: ({ driverId }) => `Driver ${driverId} was not found`,
  http: { status: 404 },
  retry: "never",
});
