/** Lists current (open) driver-to-vehicle assignments, or the full history with `includeClosed`. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import { assignmentSchema, toAssignment } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.list-assignments",
  access: { permissions: ["assignment:read"] },
  input: z.object({
    includeClosed: z.enum(["true", "false"]).default("false"),
  }),
  output: z.object({ items: z.array(assignmentSchema) }),
  handler: async ({ includeClosed }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const rows = await context.database.driverAssignment.findMany({
      where: { organizationId },
      orderBy: { field: "assignedAt", direction: "desc" },
    });
    return { items: rows.filter((row) => includeClosed === "true" || row.unassignedAt === null).map(toAssignment) };
  },
});
