import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "fleet.model-not-found",
  data: z.object({ modelId: z.string() }),
  message: ({ modelId }) => `Vehicle model ${modelId} was not found`,
  http: { status: 404 },
  retry: "never",
});
