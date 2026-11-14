/** Lists the caller's company vehicle models, newest first. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import { pageInput, toModel, vehicleModelSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.list-models",
  access: { permissions: ["vehicleModel:read"] },
  input: z.object(pageInput),
  output: z.object({ items: z.array(vehicleModelSchema), limit: z.number(), offset: z.number() }),
  handler: async ({ limit, offset }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const rows = await context.database.vehicleModel.findMany({
      where: { organizationId },
      orderBy: { field: "createdAt", direction: "desc" },
      limit,
      offset,
    });
    return { items: rows.map(toModel), limit, offset };
  },
});
