/** Drivers boundary: driver profiles, license rules, and driver-to-vehicle assignment. */
import { defineService } from "relkit/services";
import activateDriver from "@app/services/drivers/functions/activate-driver.function.js";
import createDriver from "@app/services/drivers/functions/create-driver.function.js";
import deactivateDriver from "@app/services/drivers/functions/deactivate-driver.function.js";
import getDriver from "@app/services/drivers/functions/get-driver.function.js";
import listDrivers from "@app/services/drivers/functions/list-drivers.function.js";
import updateDriver from "@app/services/drivers/functions/update-driver.function.js";

export default defineService({
  id: "drivers",
  functions: { createDriver, listDrivers, getDriver, updateDriver, activateDriver, deactivateDriver },
});
