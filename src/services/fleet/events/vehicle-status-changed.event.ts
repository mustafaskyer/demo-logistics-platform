import { defineEvent } from "relkit/events";
import { z } from "zod";

const vehicleStatusChanged = defineEvent({
  id: "fleet.vehicle-status-changed",
  version: 1,
  input: z.object({
    organizationId: z.string(),
    vehicleId: z.string(),
    from: z.enum(["active", "maintenance", "retired"]),
    to: z.enum(["active", "maintenance", "retired"]),
    at: z.string(),
  }),
  profile: "local",
});

declare global {
  namespace Relkit {
    interface EventRegistry {
      readonly "fleet.vehicle-status-changed": typeof vehicleStatusChanged;
    }
  }
}

export default vehicleStatusChanged;
