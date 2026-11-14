/** Lists the caller's company drivers, optionally filtered by status. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import { driverSchema, driverStatuses, toDriver } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.list-drivers",
  access: { permissions: ["driver:read"] },
  input: z.object({
    status: z.enum(driverStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  output: z.object({ items: z.array(driverSchema), limit: z.number(), offset: z.number() }),
  handler: async ({ status, limit, offset }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const rows = await context.database.driver.findMany({
      where: { organizationId, ...(status === undefined ? {} : { status }) },
      orderBy: { field: "createdAt", direction: "desc" },
      limit,
      offset,
    });
    return { items: rows.map(toDriver), limit, offset };
  },
});
