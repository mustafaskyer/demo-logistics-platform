import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.model-exists",
  data: z.object({ make: z.string(), name: z.string() }),
  message: ({ make, name }) => `${make} ${name} already exists`,
  http: { status: 409 },
  retry: "never",
});
