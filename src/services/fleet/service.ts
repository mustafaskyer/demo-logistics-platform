/** Fleet boundary: vehicle models and vehicles, with plate/VIN uniqueness and the status lifecycle. */
import { defineService } from "relkit/services";
import vehicleStatusChanged from "@app/services/fleet/events/vehicle-status-changed.event.js";
import changeVehicleStatus from "@app/services/fleet/functions/change-vehicle-status.function.js";
import createModel from "@app/services/fleet/functions/create-model.function.js";
import createVehicle from "@app/services/fleet/functions/create-vehicle.function.js";
import deleteModel from "@app/services/fleet/functions/delete-model.function.js";
import getVehicle from "@app/services/fleet/functions/get-vehicle.function.js";
import listModels from "@app/services/fleet/functions/list-models.function.js";
import listVehicles from "@app/services/fleet/functions/list-vehicles.function.js";
import retireVehicle from "@app/services/fleet/functions/retire-vehicle.function.js";
import updateModel from "@app/services/fleet/functions/update-model.function.js";
import updateVehicle from "@app/services/fleet/functions/update-vehicle.function.js";

export default defineService({
  id: "fleet",
  events: { vehicleStatusChanged },
  functions: {
    createModel,
    listModels,
    updateModel,
    deleteModel,
    createVehicle,
    listVehicles,
    getVehicle,
    updateVehicle,
    changeVehicleStatus,
    retireVehicle,
  },
});
