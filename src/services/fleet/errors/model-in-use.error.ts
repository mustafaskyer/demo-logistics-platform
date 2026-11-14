import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.model-in-use",
  data: z.object({ modelId: z.string(), vehicles: z.number() }),
  message: ({ modelId, vehicles }) => `Vehicle model ${modelId} is used by ${vehicles} vehicle(s)`,
  http: { status: 409 },
  retry: "never",
});
