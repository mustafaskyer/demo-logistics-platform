/** Driver collection: list (filter by status) and register. */
import { defineRoute } from "relkit/routes";
import drivers from "@app/services/drivers/service.js";

export const GET = defineRoute({ target: drivers.listDrivers });
export const POST = defineRoute({ target: drivers.createDriver, successStatus: 201 });
