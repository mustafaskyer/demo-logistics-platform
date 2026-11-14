# Logistics backend

A multi-tenant logistics backend built with [RelKit](https://relkit.dev) (TypeScript, Bun, Drizzle, Better Auth).
A logistics company registers, invites its staff, and manages its fleet and drivers. Every row belongs to a
company and every query is scoped to the caller's company.

**Phase 1 (this repo):** auth, companies and roles, vehicle models, vehicles, drivers, driver-to-vehicle
assignment, documents (driver/vehicle paperwork), and live vehicle-status updates.
**Later phases:** customers, shipments and dispatch, driver location, pricing and invoicing, notifications.

## Quick start

Requirements: [Bun](https://bun.sh), PostgreSQL 15+, and Docker (used by RelKit for the local S3 bucket).

```sh
bun install
createdb relkit_logistics
cp .env.example .env            # then fill in the values below
bun --bun run db:migrate        # applies src/services/database/migrations
bun --bun run dev               # http://127.0.0.1:4100
```

| Variable             | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string, e.g. `postgres://me@localhost:5432/relkit_logistics` |
| `BETTER_AUTH_SECRET` | Long random secret (`openssl rand -hex 32`). Never commit it.        |
| `BETTER_AUTH_URL`    | Public URL of this server, e.g. `http://127.0.0.1:4100`              |
| `LOG_LEVEL`          | `trace`…`error` (default `info`)                                     |

API reference while running: <http://127.0.0.1:4100/_relkit/v1/api-reference>.
Observability: `bun run inspector` (dev only, separate terminal).

> Use `bun --bun run <script>`. RelKit's validator imports Bun-only modules, so scripts run under plain
> Node roll back with `Cannot find package 'bun'`.

## Commands

```sh
bun --bun run check          # validate the RelKit application graph
bun --bun run typecheck
bun --bun run db:generate    # after changing src/services/database/schema/*, then review the SQL
bun --bun run db:migrate
bun run test:unit            # pure helpers, no services needed
bun run test:integration     # real server + throwaway Postgres database + Docker S3 (see below)
bun run test                 # everything
```

## Domain map

| Service     | Owns                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| `database`  | Drizzle client, schema, the single migration history                                  |
| `auth`      | Better Auth (email/password) and the **company** (organization) + member roles        |
| `fleet`     | Vehicle models and vehicles: plate/VIN uniqueness, status lifecycle, status events    |
| `drivers`   | Driver profiles, license rules, driver-to-vehicle assignment                          |
| `documents` | Driver/vehicle paperwork in the private `documents.files` bucket (signed URLs)        |

Cross-service rules: services call each other only through `service.ts`; `drivers` asks `fleet` for vehicle
state through its public function, and reacts to the `fleet.vehicle-status-changed` event (a vehicle that goes
into maintenance or is retired releases its driver).

## Tenancy and roles

A company is a Better Auth organization. The tenant id is **always taken from the session's active company**,
never from the request, so one company can never address another's data (cross-company lookups return 404).

| Role         | Fleet (models / vehicles)            | Drivers            | Assignments        | Documents          | Company members |
| ------------ | ------------------------------------ | ------------------ | ------------------ | ------------------ | --------------- |
| `owner`      | everything                           | everything         | everything         | everything         | everything      |
| `admin`      | everything                           | everything         | everything         | everything         | manage          |
| `dispatcher` | read; change vehicle status          | read               | assign / release   | read               | –               |
| `driver`     | read                                 | read               | read               | read               | –               |
| `member`     | read                                 | read               | read               | read               | –               |

Roles and permissions live in [src/services/auth/permissions.ts](src/services/auth/permissions.ts) and are
enforced with `access: { permissions: [...] }` on every function. Anonymous callers get `401`; signed-in users
without a role in the active company, or without the permission, get `403`.

### Typical flow

```sh
B=http://127.0.0.1:4100; H='content-type: application/json'; O="origin: $B"
# 1. sign up, then register the company (the creator becomes owner and the active company)
curl -c jar -X POST $B/api/auth/sign-up/email -H "$H" -H "$O" -d '{"name":"Sam","email":"sam@acme.test","password":"correct-horse-battery"}'
curl -b jar -c jar -X POST $B/api/auth/organization/create -H "$H" -H "$O" \
  -d '{"name":"Acme Freight","slug":"acme","legalName":"Acme Freight LLC","taxId":"123","country":"EG"}'
# 2. fleet and drivers
curl -b jar -X POST $B/vehicle-models -H "$H" -H "$O" -d '{"make":"Isuzu","name":"NPR","bodyType":"box_truck","capacityKg":3500}'
curl -b jar -X POST $B/vehicles -H "$H" -H "$O" -d '{"modelId":"<id>","plate":"ABC 123","year":2022}'
curl -b jar -X POST $B/drivers -H "$H" -H "$O" -d '{"fullName":"Ali Hassan","phone":"+201001234567","licenseNumber":"EG-123456","licenseClass":"B","licenseExpiresOn":"2030-01-01"}'
curl -b jar -X POST $B/driver-assignments -H "$H" -H "$O" -d '{"driverId":"<id>","vehicleId":"<id>"}'
```

Staff join through Better Auth's invitations (`/api/auth/organization/invite-member`, then the invitee calls
`accept-invitation` and `set-active`). A fresh sign-in has no active company until the client calls
`/api/auth/organization/set-active`.

## Endpoints

| Resource            | Routes                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Auth, companies     | `/api/auth/*` (Better Auth, including `/organization/*`)                                                 |
| Vehicle models      | `GET/POST /vehicle-models`, `PATCH/DELETE /vehicle-models/:modelId`                                      |
| Vehicles            | `GET/POST /vehicles`, `GET/PATCH /vehicles/:vehicleId`, `PUT …/status`, `POST …/retire`                  |
| Drivers             | `GET/POST /drivers`, `GET/PATCH /drivers/:driverId`, `POST …/activate`, `POST …/deactivate`, `DELETE …/vehicle` |
| Assignments         | `GET/POST /driver-assignments` (`?includeClosed=true` for history)                                       |
| Documents           | `GET/POST /documents`, `POST /documents/:id/confirm`, `GET /documents/:id/download`, `DELETE /documents/:id` |
| Live vehicle status | Realtime channel `fleet.vehicle-status` (`{ companyId }`), event `changed`                               |

Errors are RFC 9457-style problem objects with a stable `code`, e.g. `fleet.plate-taken` (409),
`drivers.license-expired` (422), `access-denied` (403).

**Documents** use signed URLs: `POST /documents` records a pending document and returns `uploadUrl`; `PUT` the
file there; `POST …/confirm` verifies the stored size and publishes it. Allowed: PDF/JPEG/PNG up to 5 MB.

## Testing

`bun run test:integration` boots the real application (`relkit dev`) against a **throwaway database** created
and migrated per run, then drops it. It writes a temporary, gitignored `.env.test` (`NODE_ENV=test`) so the
server can never touch your development database, and it verifies that before running anything.
Docker must be running for the S3 bucket (`TEST_LOCAL_SERVICES=off` skips local services, but then the app
cannot start while the bucket profile is the Docker one). Useful variables: `TEST_DATABASE_ADMIN_URL`
(default `postgres://localhost:5432/postgres`) and `TEST_SERVER_LOG=/path/file.log` to keep the server log.

The tests run against the real server because `@relkit/testing`'s in-process HTTP client (0.9.0) does not
evaluate function `access` rules.

## Before deploying

`bun run build` currently **fails by design**: the bucket profile is the Docker S3 used for development, and
RelKit refuses local-only providers in a production build (`RELKIT_PROVIDER_RELEASE_SOURCE_REQUIRED`).
Before deploying, in [relkit.config.ts](relkit.config.ts):

1. Replace `bucket: { local: docker(s3()) }` with a connected S3-compatible source (verified to build):
   `s3({ endpoint: binding.url("S3_ENDPOINT"), bucketName: binding.string("S3_BUCKET"), region: binding.string("S3_REGION"), credentials: { accessKeyId: binding.secret("S3_ACCESS_KEY_ID"), secretAccessKey: binding.secret("S3_SECRET_ACCESS_KEY") } })`
   and set those variables in the environment.
2. Move events from the local filesystem provider to Postgres (`bun --bun run relkit add events --provider postgres`);
   the container image refuses local durable state.
3. Use a multi-instance realtime provider (Redis) if you run more than one instance.
4. Disable the Inspector in production builds (it is excluded automatically) and set a strong `BETTER_AUTH_SECRET`.

## Layout

```
src/platform/        env contract and tenant helpers (no service imports)
src/services/<name>/ service.ts, functions/, errors/, events/, channels/, buckets/, schemas.ts
src/routes/          route.ts files; [param] folders are path parameters
tests/unit           pure helpers
tests/integration    end-to-end HTTP tests (real server, throwaway database)
tests/support        harness: database lifecycle, cookie-aware clients
```
