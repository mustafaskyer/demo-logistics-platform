import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.user-already-driver",
  data: z.object({ userId: z.string() }),
  message: ({ userId }) => `User ${userId} is already linked to a driver`,
  http: { status: 409 },
  retry: "never",
});
