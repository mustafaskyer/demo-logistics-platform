/** Vehicle model collection: list and create. */
import { defineRoute } from "relkit/routes";
import fleet from "@app/services/fleet/service.js";

export const GET = defineRoute({ target: fleet.listModels });
export const POST = defineRoute({ target: fleet.createModel, successStatus: 201 });
