import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.invalid-status-transition",
  data: z.object({ from: z.string(), to: z.string() }),
  message: ({ from, to }) => `Cannot move a vehicle from ${from} to ${to}`,
  http: { status: 409 },
  retry: "never",
});
