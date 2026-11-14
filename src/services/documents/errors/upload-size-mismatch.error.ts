import { defineError } from "relkit/functions";
import { z } from "zod";

export default defineError({
  id: "documents.upload-size-mismatch",
  data: z.object({ expected: z.number(), actual: z.number() }),
  message: ({ expected, actual }) => `Uploaded file is ${actual} bytes; ${expected} were declared`,
  http: { status: 422 },
  retry: "never",
});
