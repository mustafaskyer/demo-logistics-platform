/** Driver-to-vehicle assignments: list current ones and assign. */
import { defineRoute } from "relkit/routes";
import drivers from "@app/services/drivers/service.js";

export const GET = defineRoute({ target: drivers.listAssignments });
export const POST = defineRoute({ target: drivers.assignVehicle, successStatus: 201 });
