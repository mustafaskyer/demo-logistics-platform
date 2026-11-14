import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.plate-taken",
  data: z.object({ plate: z.string() }),
  message: ({ plate }) => `Plate ${plate} is already registered`,
  http: { status: 409 },
  retry: "never",
});
