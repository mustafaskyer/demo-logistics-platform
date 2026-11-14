import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "documents.owner-not-found",
  data: z.object({ ownerType: z.string(), ownerId: z.string() }),
  message: ({ ownerType, ownerId }) => `The ${ownerType} ${ownerId} was not found`,
  http: { status: 404 },
  retry: "never",
});
