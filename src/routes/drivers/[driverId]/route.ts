/** One driver: read and update. */
import { defineRoute, http } from "relkit/routes";
import drivers from "@app/services/drivers/service.js";

export const GET = defineRoute({
  target: drivers.getDriver,
  request: http.input({ driverId: http.path("driverId") }),
});

export const PATCH = defineRoute({
  target: drivers.updateDriver,
  request: http.input({
    driverId: http.path("driverId"),
    fullName: http.optional(http.body("fullName")),
    phone: http.optional(http.body("phone")),
    licenseNumber: http.optional(http.body("licenseNumber")),
    licenseClass: http.optional(http.body("licenseClass")),
    licenseExpiresOn: http.optional(http.body("licenseExpiresOn")),
  }),
});
