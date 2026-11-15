/**
 * Integration harness. Runs the real application (`relkit dev`) against a throwaway Postgres
 * database migrated with the project's own migrations, so access rules, cookies, middleware and
 * HTTP mapping are exercised exactly as in production. (This harness was written on RelKit 0.9.0,
 * whose in-process HTTP client in `@relkit/testing` skipped function access rules; 0.9.1 evaluates
 * them, but the served application still covers the cookies, `Origin` checks and HTTP mapping.)
 *
 * One server is shared by all test files in a run; every test creates its own companies and users.
 */
import { SQL } from "bun";
import { rm } from "node:fs/promises";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://localhost:5432/postgres";
const projectRoot = new URL("../../", import.meta.url).pathname;
const testEnvFile = `${projectRoot}.env.test`;

export interface Harness {
  readonly baseUrl: string;
  readonly databaseName: string;
  /** Direct SQL access to the test database for assertions and fixtures. */
  readonly sql: SQL;
}

let starting: Promise<Harness> | undefined;
let stop: (() => Promise<void>) | undefined;

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  await probe.stop(true);
  if (port === undefined) throw new Error("could not allocate a port");
  return port;
}

/** Drops databases left behind by interrupted runs (only those nobody is connected to). */
async function dropStaleDatabases(admin: SQL): Promise<void> {
  const rows = (await admin.unsafe(
    `SELECT datname FROM pg_database d WHERE datname LIKE 'relkit_test_%'
       AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)`,
  )) as Array<{ datname: string }>;
  for (const row of rows) await admin.unsafe(`DROP DATABASE IF EXISTS ${row.datname}`);
}

async function boot(): Promise<Harness> {
  const databaseName = `relkit_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = new SQL(adminUrl);
  await dropStaleDatabases(admin);
  await admin.unsafe(`CREATE DATABASE ${databaseName}`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const values = {
    DATABASE_URL: databaseUrl.toString(),
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-000",
    BETTER_AUTH_URL: baseUrl,
    LOG_LEVEL: "warn",
  };
  // `relkit dev` resolves dotenv files ahead of the process environment, so a plain env override
  // would silently hit the developer's database. In NODE_ENV=test `.env.test` outranks `.env`.
  await Bun.write(testEnvFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  const env = { ...process.env, ...values, NODE_ENV: "test" };

  const drop = async () => {
    await rm(testEnvFile, { force: true });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.close();
  };

  const migrate = Bun.spawnSync(["bun", "--bun", "x", "relkit", "db", "migrate"], {
    cwd: projectRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (migrate.exitCode !== 0) {
    await drop();
    throw new Error(`Migration failed: ${migrate.stderr.toString()}${migrate.stdout.toString()}`);
  }

  const server = Bun.spawn([
    "bun", "--bun", "x", "relkit", "dev", "--port", String(port), "--no-color", "--local", process.env.TEST_LOCAL_SERVICES ?? "on",
    ...(process.env.TEST_SERVER_LOG === undefined ? [] : ["--verbose", "--log-level", "debug"]),
  ], {
    cwd: projectRoot,
    env,
    // Set TEST_SERVER_LOG=/path/to/file to keep the server's output for diagnosis.
    stdout: process.env.TEST_SERVER_LOG === undefined ? "ignore" : Bun.file(process.env.TEST_SERVER_LOG),
    stderr: process.env.TEST_SERVER_LOG === undefined ? "ignore" : Bun.file(process.env.TEST_SERVER_LOG),
  });

  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      ready = (await fetch(`${baseUrl}/hello`)).status === 200;
    } catch {
      /* not listening yet */
    }
    if (!ready) await Bun.sleep(500);
  }
  const sql = new SQL(databaseUrl.toString());
  stop = async () => {
    server.kill();
    await server.exited;
    await sql.close();
    await drop();
  };
  if (!ready) {
    await stop();
    throw new Error("The application did not become ready");
  }
  // Prove the isolation: the server must be talking to the throwaway database, never the dev one.
  const probe = (await sql.unsafe("SELECT current_database() AS name")) as Array<{ name: string }>;
  if (probe[0]?.name !== databaseName) {
    await stop();
    throw new Error("Test harness is not connected to its throwaway database");
  }
  return { baseUrl, databaseName, sql };
}

/** Starts (once) and returns the shared application. */
export function startHarness(): Promise<Harness> {
  starting ??= boot();
  return starting;
}

/** Stops the server and drops the test database; called from the test preload. */
export async function stopHarness(): Promise<void> {
  if (starting === undefined) return;
  await starting.catch(() => undefined);
  await stop?.();
  starting = undefined;
  stop = undefined;
}

export interface ApiResult<T = any> {
  readonly status: number;
  readonly body: T;
}

/** A signed-in user with its own cookie jar. */
export class TestUser {
  private cookie = "";

  /** The Cookie header for clients that talk to the server directly (for example realtime). */
  get cookieHeader(): string {
    return this.cookie;
  }

  constructor(
    private readonly harness: Harness,
    readonly email: string,
  ) {}

  async call<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { origin: this.harness.baseUrl, "content-type": "application/json" };
    if (this.cookie !== "") headers.cookie = this.cookie;
    const response = await fetch(`${this.harness.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const name = pair.split("=")[0] ?? "";
      this.cookie = [...this.cookie.split("; ").filter((c) => c !== "" && !c.startsWith(`${name}=`)), pair].join("; ");
    }
    const text = await response.text();
    return { status: response.status, body: (text === "" ? null : JSON.parse(text)) as T };
  }

  get = <T = any>(path: string) => this.call<T>("GET", path);
  post = <T = any>(path: string, body?: unknown) => this.call<T>("POST", path, body);
  put = <T = any>(path: string, body?: unknown) => this.call<T>("PUT", path, body);
  patch = <T = any>(path: string, body?: unknown) => this.call<T>("PATCH", path, body);
  delete = <T = any>(path: string) => this.call<T>("DELETE", path);
}

/** Registers a user. */
export async function signUp(harness: Harness, name: string, email: string): Promise<TestUser> {
  const user = new TestUser(harness, email);
  const result = await user.post("/api/auth/sign-up/email", { name, email, password: "correct-horse-battery" });
  if (result.status !== 200) throw new Error(`sign-up failed: ${JSON.stringify(result.body)}`);
  return user;
}

/** Registers a user and a company they own (the company becomes the session's active company). */
export async function registerCompany(harness: Harness, label: string): Promise<TestUser> {
  const owner = await signUp(harness, `${label} Owner`, `${label.toLowerCase()}-owner@example.com`);
  const created = await owner.post("/api/auth/organization/create", { name: label, slug: label.toLowerCase() });
  if (created.status !== 200) throw new Error(`company creation failed: ${JSON.stringify(created.body)}`);
  return owner;
}

/** Invites a new user into the owner's company with a role and activates the company for them. */
export async function addMember(
  harness: Harness,
  owner: TestUser,
  label: string,
  role: "admin" | "dispatcher" | "driver" | "member",
): Promise<TestUser> {
  const member = await signUp(harness, label, `${label.toLowerCase()}@example.com`);
  const invited = await owner.post("/api/auth/organization/invite-member", { email: member.email, role });
  if (invited.status !== 200) throw new Error(`invite failed: ${JSON.stringify(invited.body)}`);
  const accepted = await member.post("/api/auth/organization/accept-invitation", { invitationId: invited.body.id });
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  const organizations = await member.get("/api/auth/organization/list");
  await member.post("/api/auth/organization/set-active", { organizationId: organizations.body[0].id });
  return member;
}

/** Polls until `read` returns a value accepted by `done`, for event-driven reactions. */
export async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await Bun.sleep(100);
  }
}

export const sampleDriver = (overrides: Record<string, unknown> = {}) => ({
  fullName: "Ali Hassan",
  phone: "+201001234567",
  licenseNumber: "EG-123456",
  licenseClass: "b",
  licenseExpiresOn: "2099-01-01",
  ...overrides,
});

export const sampleModel = (overrides: Record<string, unknown> = {}) => ({
  make: "Isuzu",
  name: "NPR",
  bodyType: "box_truck",
  capacityKg: 3500,
  ...overrides,
});

export const sampleVehicle = (modelId: string, overrides: Record<string, unknown> = {}) => ({
  modelId,
  plate: "TRK 1",
  year: 2021,
  ...overrides,
});
