import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "drivers.user-not-in-company",
  data: z.object({ userId: z.string() }),
  message: ({ userId }) => `User ${userId} is not a member of this company`,
  http: { status: 422 },
  retry: "never",
});
