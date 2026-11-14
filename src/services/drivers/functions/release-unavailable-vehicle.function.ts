/** Reacts to fleet status changes: a vehicle that is no longer active loses its driver. */
import { defineEventFunction } from "relkit/events";

export default defineEventFunction({
  id: "drivers.release-unavailable-vehicle",
  event: "fleet.vehicle-status-changed",
  profile: "local",
  handler: async ({ organizationId, vehicleId, to }, context) => {
    if (to === "active") return;
    const open = (await context.database.driverAssignment.findMany({ where: { organizationId, vehicleId } })).filter(
      (row) => row.unassignedAt === null,
    );
    for (const row of open) {
      await context.database.driverAssignment.update({ where: { id: row.id }, data: { unassignedAt: new Date() } });
    }
    context.log.info("released driver from unavailable vehicle", { vehicleId, to, released: open.length });
  },
});
