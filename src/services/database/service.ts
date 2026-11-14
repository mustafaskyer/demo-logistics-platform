import { defineDrizzleService } from "@relkit/drizzle";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema/index.js";

export default defineDrizzleService({
  schema,
  client: ({ env }) => {
    const url = env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return drizzle.postgres(url);
  },
  dispose: (database) => database.$client.close(),
});
