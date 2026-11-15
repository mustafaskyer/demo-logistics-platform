import { defineDrizzleService } from "@relkit/drizzle";
import { openPostgresDatabase } from "@relkit/drizzle/pg";
import * as schema from "./schema/index.js";

export default defineDrizzleService({
  schema,
  client: ({ env }) => {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return openPostgresDatabase(url);
  },
  dispose: (database) => database.$client.end(),
});
