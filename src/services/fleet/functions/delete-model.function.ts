/** Deletes a vehicle model that no vehicle uses. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { constraintViolation, currentTenant } from "@app/platform/tenant.js";
import modelInUse from "@app/services/fleet/errors/model-in-use.error.js";
import modelNotFound from "@app/services/fleet/errors/model-not-found.error.js";

export default defineFunction({
  id: "fleet.delete-model",
  access: { permissions: ["vehicleModel:delete"] },
  input: z.object({ modelId: z.string().min(1) }),
  output: z.object({ deleted: z.literal(true) }),
  errors: [modelNotFound, modelInUse],
  handler: async ({ modelId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const model = await context.database.vehicleModel.findOne({ where: { id: modelId, organizationId } });
    if (model === null) return modelNotFound.create({ modelId });
    const users = await context.database.vehicle.findMany({ where: { organizationId, modelId } });
    if (users.length > 0) return modelInUse.create({ modelId, vehicles: users.length });
    try {
      await context.database.vehicleModel.delete({ where: { id: modelId, organizationId } });
    } catch (error) {
      // A vehicle was created between the check and the delete; the restrict FK is the final guard.
      if (constraintViolation(error)?.kind === "foreign-key") return modelInUse.create({ modelId, vehicles: 1 });
      throw error;
    }
    return { deleted: true as const };
  },
});
