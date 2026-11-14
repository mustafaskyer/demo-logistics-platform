/** Lists the uploaded documents of one driver or vehicle. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import { documentSchema, ownerTypes, toDocument } from "@app/services/documents/schemas.js";

export default defineFunction({
  id: "documents.list-documents",
  access: { permissions: ["document:read"] },
  input: z.object({ ownerType: z.enum(ownerTypes), ownerId: z.string().min(1) }),
  output: z.object({ items: z.array(documentSchema) }),
  handler: async ({ ownerType, ownerId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const rows = await context.database.document.findMany({
      where: { organizationId, ownerType, ownerId, status: "uploaded" },
      orderBy: { field: "createdAt", direction: "desc" },
    });
    return { items: rows.map(toDocument) };
  },
});
