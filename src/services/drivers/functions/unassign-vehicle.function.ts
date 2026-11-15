/** Releases the driver's current vehicle. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { currentTenant } from "@app/platform/tenant.js";
import noOpenAssignment from "@app/services/drivers/errors/no-open-assignment.error.js";
import { assignmentSchema, toAssignment } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.unassign-vehicle",
  access: { permissions: ["assignment:delete"] },
  input: z.object({ driverId: text().min(1) }),
  output: assignmentSchema,
  errors: [noOpenAssignment],
  handler: async ({ driverId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const open = (await context.database.driverAssignment.findMany({ where: { organizationId, driverId } })).find(
      (row) => row.unassignedAt === null,
    );
    if (open === undefined) return noOpenAssignment.create({ driverId });
    const closed = await context.database.driverAssignment.update({
      where: { id: open.id, organizationId },
      data: { unassignedAt: new Date() },
    });
    return closed === null ? noOpenAssignment.create({ driverId }) : toAssignment(closed);
  },
});
