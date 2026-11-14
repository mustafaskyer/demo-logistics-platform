/** Moves a vehicle between active and maintenance, then announces the change. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import invalidTransition from "@app/services/fleet/errors/invalid-status-transition.error.js";
import vehicleNotFound from "@app/services/fleet/errors/vehicle-not-found.error.js";
import vehicleStatusChanged from "@app/services/fleet/events/vehicle-status-changed.event.js";
import { toVehicle, vehicleSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.change-vehicle-status",
  access: { permissions: ["vehicle:changeStatus"] },
  input: z.object({ vehicleId: z.string().min(1), status: z.enum(["active", "maintenance"]) }),
  output: vehicleSchema,
  errors: [vehicleNotFound, invalidTransition],
  dependencies: { events: { vehicleStatusChanged } },
  handler: async ({ vehicleId, status }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const current = await context.database.vehicle.findOne({ where: { id: vehicleId, organizationId } });
    if (current === null) return vehicleNotFound.create({ vehicleId });
    if (current.status === "retired" || current.status === status) {
      return invalidTransition.create({ from: current.status, to: status });
    }
    const updated = await context.database.vehicle.update({
      where: { id: vehicleId, organizationId },
      data: { status, updatedAt: new Date() },
    });
    if (updated === null) return vehicleNotFound.create({ vehicleId });
    await context.events.vehicleStatusChanged.publish({
      organizationId,
      vehicleId,
      from: current.status,
      to: status,
      at: updated.updatedAt.toISOString(),
    });
    return toVehicle(updated);
  },
});
