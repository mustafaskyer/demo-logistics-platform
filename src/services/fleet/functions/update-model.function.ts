/** Updates a vehicle model's name, body type or capacity within the caller's company. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { constraintViolation, currentTenant, definedOnly } from "@app/platform/tenant.js";
import modelExists from "@app/services/fleet/errors/model-exists.error.js";
import modelNotFound from "@app/services/fleet/errors/model-not-found.error.js";
import { bodyTypes, toModel, vehicleModelSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.update-model",
  access: { permissions: ["vehicleModel:update"] },
  input: z.object({
    modelId: text().min(1),
    make: text().trim().min(1).max(60).optional(),
    name: text().trim().min(1).max(60).optional(),
    bodyType: z.enum(bodyTypes).optional(),
    capacityKg: z.number().int().min(1).max(100_000).optional(),
  }),
  output: vehicleModelSchema,
  errors: [modelNotFound, modelExists],
  handler: async ({ modelId, ...changes }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const current = await context.database.vehicleModel.findOne({ where: { id: modelId, organizationId } });
    if (current === null) return modelNotFound.create({ modelId });
    const make = changes.make ?? current.make;
    const name = changes.name ?? current.name;
    const duplicate = () => modelExists.create({ make, name });
    if (make !== current.make || name !== current.name) {
      const clash = await context.database.vehicleModel.findOne({ where: { organizationId, make, name } });
      if (clash !== null && clash.id !== modelId) return duplicate();
    }
    try {
      const updated = await context.database.vehicleModel.update({
        where: { id: modelId, organizationId },
        data: { ...definedOnly(changes), updatedAt: new Date() },
      });
      return updated === null ? modelNotFound.create({ modelId }) : toModel(updated);
    } catch (error) {
      if (constraintViolation(error)?.kind === "unique") return duplicate();
      throw error;
    }
  },
});
