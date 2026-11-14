/** Lists the caller's company vehicles, optionally filtered by status or model. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import { pageInput, toVehicle, vehicleSchema, vehicleStatuses } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.list-vehicles",
  access: { permissions: ["vehicle:read"] },
  input: z.object({
    status: z.enum(vehicleStatuses).optional(),
    modelId: z.string().min(1).optional(),
    ...pageInput,
  }),
  output: z.object({ items: z.array(vehicleSchema), limit: z.number(), offset: z.number() }),
  handler: async ({ status, modelId, limit, offset }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const rows = await context.database.vehicle.findMany({
      where: {
        organizationId,
        ...(status === undefined ? {} : { status }),
        ...(modelId === undefined ? {} : { modelId }),
      },
      orderBy: { field: "createdAt", direction: "desc" },
      limit,
      offset,
    });
    return { items: rows.map(toVehicle), limit, offset };
  },
});
