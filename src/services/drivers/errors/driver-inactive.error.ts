import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.driver-inactive",
  data: z.object({ driverId: z.string() }),
  message: ({ driverId }) => `Driver ${driverId} is inactive`,
  http: { status: 409 },
  retry: "never",
});
