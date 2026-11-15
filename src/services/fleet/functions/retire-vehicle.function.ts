/** Permanently retires a vehicle. Retirement is terminal and closes its open driver assignment. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { currentTenant } from "@app/platform/tenant.js";
import invalidTransition from "@app/services/fleet/errors/invalid-status-transition.error.js";
import vehicleNotFound from "@app/services/fleet/errors/vehicle-not-found.error.js";
import vehicleStatus from "@app/services/fleet/channels/vehicle-status.channel.js";
import vehicleStatusChanged from "@app/services/fleet/events/vehicle-status-changed.event.js";
import { toVehicle, vehicleSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.retire-vehicle",
  access: { permissions: ["vehicle:delete"] },
  input: z.object({ vehicleId: text().min(1) }),
  output: vehicleSchema,
  errors: [vehicleNotFound, invalidTransition],
  dependencies: { events: { vehicleStatusChanged }, channels: { vehicleStatus } },
  handler: async ({ vehicleId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const current = await context.database.vehicle.findOne({ where: { id: vehicleId, organizationId } });
    if (current === null) return vehicleNotFound.create({ vehicleId });
    if (current.status === "retired") return invalidTransition.create({ from: "retired", to: "retired" });
    // Retirement wins over a concurrent status change: it does not depend on the status that was read.
    const updated = await context.database.vehicle.update({
      where: { id: vehicleId, organizationId },
      data: { status: "retired", updatedAt: new Date() },
    });
    if (updated === null) return vehicleNotFound.create({ vehicleId });
    await context.events.vehicleStatusChanged.publish({
      organizationId,
      vehicleId,
      from: current.status,
      to: "retired",
      at: updated.updatedAt.toISOString(),
    });
    await context.channels.vehicleStatus.trigger(
      { companyId: organizationId },
      "changed",
      { vehicleId, from: current.status, to: "retired", at: updated.updatedAt.toISOString() },
    );
    return toVehicle(updated);
  },
});
