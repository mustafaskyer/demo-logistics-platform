/** One vehicle model: update and delete. */
import { defineRoute, http } from "relkit/routes";
import fleet from "@app/services/fleet/service.js";

export const PATCH = defineRoute({
  target: fleet.updateModel,
  request: http.input({
    modelId: http.path("modelId"),
    make: http.optional(http.body("make")),
    name: http.optional(http.body("name")),
    bodyType: http.optional(http.body("bodyType")),
    capacityKg: http.optional(http.body("capacityKg")),
  }),
});

export const DELETE = defineRoute({
  target: fleet.deleteModel,
  request: http.input({ modelId: http.path("modelId") }),
});
