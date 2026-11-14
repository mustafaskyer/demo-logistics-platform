/** Vehicle collection: list (filter by status or model) and register. */
import { defineRoute } from "relkit/routes";
import fleet from "@app/services/fleet/service.js";

export const GET = defineRoute({ target: fleet.listVehicles });
export const POST = defineRoute({ target: fleet.createVehicle, successStatus: 201 });
