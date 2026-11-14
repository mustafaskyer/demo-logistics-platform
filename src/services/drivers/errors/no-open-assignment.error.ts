import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.no-open-assignment",
  data: z.object({ driverId: z.string() }),
  message: ({ driverId }) => `Driver ${driverId} has no assigned vehicle`,
  http: { status: 404 },
  retry: "never",
});
