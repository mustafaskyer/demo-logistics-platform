# API validation checklist

Every API this application serves, as items that one agent can take, run and validate alone. Each item
says who may call it, what to create first, one request that must succeed, every declared error with the
request that triggers it, the side effects to check, the harness rows that already cover it, and where to
write the result for Node and for Bun.

Derived on 2026-11-15 from the application on RelKit **0.9.1** (`relkit`, `@relkit/*`, Better Auth 1.7.7):
the served `GET /_relkit/v1/openapi.json` (25 application operations, 54 Better Auth operations), the
route and function sources under `src/`, the permission table in `src/services/auth/permissions.ts`, and
requests sent to the running application on Node and on Bun. The expected answers below are the answers
that were observed, and they agree with the sources.

Contents: [0 Setup](#0-setup) · [1 Better Auth](#1-better-auth-endpoints-the-app-relies-on) ·
[2 Fleet](#2-fleet-vehicle-models-and-vehicles) · [3 Drivers and assignments](#3-drivers-and-assignments) ·
[4 Documents](#4-documents) · [5 Event reaction](#5-event-reaction) · [6 Realtime](#6-realtime-channel-fleetvehicle-status) ·
[7 System routes](#7-system-routes) · [8 Cross-cutting HTTP](#8-cross-cutting-http-behaviour) ·
[9 Known and by design](#9-known-and-by-design-do-not-report) · [10 Reporting a failure](#10-how-to-report-a-failure)

---

## 0 Setup

### 0.1 Requirements

- Node ≥ 22.13 and Bun ≥ 1.3.10 (`node -v`, `bun -v`).
- PostgreSQL reachable from this machine, with `createdb` and `psql` on the `PATH`.
- Docker running: `relkit dev` starts a MinIO container for the private `documents.files` bucket.
- `curl` ≥ 7.84 (the helpers print `%header{x-request-id}`) and `jq`.
- Run every command from the project root, in bash or zsh.

### 0.2 Install

```bash
npm ci
```

`package-lock.json` resolves every RelKit package to 0.9.1 on the public npm registry. The project is
npm first; `bun install` also works (it resolves `package.json`, whose direct dependencies are pinned), but
do not commit the `bun.lock` it writes.

### 0.3 `.env` and database

Skip this step if `.env` already exists and its database answers `psql "$DATABASE_URL" -c 'select 1'`.

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable | Value |
|---|---|
| `LOG_LEVEL` | `info` |
| `DATABASE_URL` | a database of your own, for example `postgres://localhost:5432/relkit_logistics_checklist`. Never point it at a database somebody else uses. |
| `BETTER_AUTH_SECRET` | the output of `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://127.0.0.1:<port>`, the exact origin you will call. Better Auth trusts only this origin, so the server must be started on this port and every request must send `Origin: http://127.0.0.1:<port>` (not `localhost`). This checklist uses port **4110**. |

Create the database named in `DATABASE_URL` and migrate it:

```bash
createdb relkit_logistics_checklist
```

```bash
npm run db:migrate
```

Expected: `Applied 6 migrations; the database is up to date.` (or `Database is up to date: no migrations were pending.` on a second run).

### 0.4 Start the application

One server at a time on the port; it must be the port in `BETTER_AUTH_URL`.

On Node:

```bash
npm run dev -- --port 4110
```

On Bun:

```bash
bun run dev --port 4110
```

Wait until it answers:

```bash
until curl -sf http://127.0.0.1:4110/healthz; do sleep 1; done; echo
```

Expected: `{"status":"ready","live":true,"ready":true}`. To confirm which runtime serves, the generated server
process is `node … .relkit/generated/.dev-*/…/server/index.ts` on Node and `bun --no-env-file …` on Bun:

```bash
pgrep -fl '.relkit/generated/.dev-' | cut -c1-120
```

Stop the server with Ctrl-C (or `kill` the `relkit dev` process). It removes its MinIO container, so
stored files do not survive a restart: a document confirmed before the restart still has its database row,
but its download URL answers 404. Items create their own documents, so this only matters if you keep one
item's data across the switch from Node to Bun (don't).

**Runtime phases.** Every item has a Node and a Bun result line. When several agents share one server,
fill all Node lines first; one coordinator then stops the Node server and starts the Bun server, and the
agents fill the Bun lines. An agent working alone may switch itself. Never restart a server that other
agents are using.

### 0.5 Shell helpers and the `Origin` rule

Each item uses its own state folder, so items never share actors or data:

```bash
export BASE=http://127.0.0.1:4110 S=/tmp/relkit-checklist/<ITEM-ID>
source scripts/checklist/lib.sh
```

`scripts/checklist/lib.sh` defines:

| Helper | What it does |
|---|---|
| `call <actor> <METHOD> <path> ['<json>'] [curl args]` | Sends one request as `<actor>` with the cookie jar `$S/<actor>.jar` (read and updated). Prints the body, then `HTTP <status> x-request-id: <id>`. Actor `anon` sends no cookie and keeps none. The fourth argument is the JSON body (sent with `Content-Type: application/json`) unless it starts with `-`, in which case it and the rest go to curl as they are. |
| `code …` | Same arguments; prints only the status. |
| `json …` | Same arguments; prints only the body (pipe it to `jq`). |
| `sql '<query>'` | Read-only query against `DATABASE_URL` from `./.env`. Column names are camelCase and must be double-quoted: `sql 'select "unassignedAt" from driver_assignment'`. |

**Cookies.** Better Auth sets `better-auth.session_token` (HttpOnly, SameSite=Lax, Max-Age 604800). The
helpers keep one curl cookie jar per actor in `$S`. Do not share a jar between agents.

**The `Origin` rule for state-changing requests** (POST, PUT, PATCH, DELETE). Always send
`Origin: $BASE`; the helpers do so. Set `NO_ORIGIN=1` or `ORIGIN=<value>` in front of a helper to test the
rule. What was observed:

| Request | Answer |
|---|---|
| any route, `Origin: $BASE` | served |
| any route, foreign `Origin` (`https://evil.example`) | 403 `origin-denied` (Problem Details) |
| `/api/auth/*` with a session cookie and no `Origin` | 403 `{"code":"MISSING_OR_NULL_ORIGIN"}` (Better Auth) |
| application route with a session cookie and no `Origin`, sent by curl | served (in development a request without `Origin`, `Referer` or `Sec-Fetch-Site` is a trusted service call) |
| `/api/auth/sign-in/email` without cookie and without `Origin` | curl: 200; Node `fetch`: 403 `MISSING_OR_NULL_ORIGIN` (Node sends `Sec-Fetch-Mode`) |
| WebSocket upgrade to `/_relkit/v1/rpc` | foreign `Origin`: 403; same or no `Origin`: accepted |

### 0.6 Actors

```bash
scripts/checklist/setup-actors.sh "$S" && source "$S/ids.env"
```

Expected last line: `actors ready in … (company A …, company B …)`. The script exits non-zero and prints
the failing answer otherwise. It creates, with new e-mails and slugs on every run:

| Actor (jar) | Who | Active company |
|---|---|---|
| `owner` | signs up, creates company A (becomes `owner`) | A |
| `admin`, `dispatcher`, `driver`, `member` | sign up, invited by `owner` with that role, accept, `set-active` A | A |
| `ownerB` | signs up, creates company B | B |
| `nocompany` | signs up only | none |
| `anon` | no session | – |

`$S/ids.env` holds `BASE`, `RUN`, `PASSWORD` (`correct-horse-battery`), `COMPANY_A`, `COMPANY_B`,
`OWNER_ID`, `ADMIN_ID`, `DISPATCHER_ID`, `DRIVER_ID`, `MEMBER_ID`, `OWNERB_ID`, `NOCOMPANY_ID` and
`EMAIL_PREFIX` (each actor's e-mail is `${EMAIL_PREFIX}<actor>@example.test`). The requests it sends are the
ones of items AUTH-01, AUTH-05, AUTH-07, AUTH-08 and AUTH-09.

### 0.7 Fixtures

Each item says which of these to run first, in this order. Values are fixed because every item has its
own company (plates, VINs and license numbers are unique per company only).

```bash
# F-MODEL -> $M
M=$(json owner POST /vehicle-models '{"make":"Isuzu","name":"NPR","bodyType":"box_truck","capacityKg":3500}' | jq -r .id)
# F-VEHICLE (needs $M) -> $V, an active vehicle
V=$(json owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"CK 1\",\"year\":2022}" | jq -r .id)
# F-DRIVER -> $D, an active driver with a valid license
D=$(json owner POST /drivers '{"fullName":"Ali Hassan","phone":"+201001234567","licenseNumber":"CK-0001","licenseClass":"B","licenseExpiresOn":"2030-01-01"}' | jq -r .id)
# F-ASSIGN (needs $D and $V) -> $A, an open assignment
A=$(json owner POST /driver-assignments "{\"driverId\":\"$D\",\"vehicleId\":\"$V\"}" | jq -r .id)
```

```bash
# F-DOC (needs $D) -> $DOC, an uploaded and confirmed document of driver $D
printf '%%PDF-1.4 checklist sample\n' > "$S/sample.pdf"; SIZE=$(wc -c < "$S/sample.pdf" | tr -d ' ')
json owner POST /documents "{\"ownerType\":\"driver\",\"ownerId\":\"$D\",\"kind\":\"license\",\"filename\":\"license scan.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":$SIZE}" > "$S/upload.json"
DOC=$(jq -r .document.id "$S/upload.json")
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT "$(jq -r .uploadUrl "$S/upload.json")" -H 'Content-Type: application/pdf' --data-binary @"$S/sample.pdf"
code owner POST /documents/$DOC/confirm
```

F-DOC prints `200` twice. Check any fixture variable with `echo $M $V $D $A $DOC`; a value of `null` means
the request failed (run it with `call` to see why).

### 0.8 Order, independence and parallel runs

- **No item depends on another item's data.** Every item runs setup (0.5 and 0.6) in its own `$S` and
  creates its own fixtures, so any item can run alone, in any order, after the server is up.
- **Parallel-safe:** every item in sections 1 to 7 may run at the same time as any other on one server.
- **Run one at a time:** harness runs (`node scripts/audit/run.mjs …`, about 60 s and 1,243 requests for a
  full run), and item X-01. They are not wrong in parallel, but they load the machine and make latency
  notes meaningless.
- Section 9 lists answers that look wrong but are intended. Read it before reporting.

### 0.9 The request harness

`scripts/audit/run.mjs` sends the audit's request matrix. Every item names its rows; to run one group:

```bash
node scripts/audit/run.mjs --base-url $BASE --out /tmp/relkit-audit/<ITEM-ID>-node --env npm --project "$PWD" --only <group>
```

On Bun use `bun scripts/audit/run.mjs … --env bun`. Groups: `auth`, `actors`, `matrix`, `lifecycle`,
`validation`, `http`, `effects`, `system`, `contract` (`--only` adds `actors` itself when a group needs it).
Rows are in `<out>/results.jsonl`, one JSON object per row with `id`, `pass`, `expected`, `actual`,
`requestId`; read one with `grep '"id":"<row id>"' <out>/results.jsonl | jq`.

Reference result of a full run, identical on Node and on Bun (2026-11-15): 1,243 rows, 1,191 as expected,
52 not as expected, all 52 by design (section 9), no 5xx.

| Group | Rows | As expected | Not as expected (all in section 9) |
|---|---|---|---|
| auth | 65 | 63 | 2 |
| actors | 32 | 32 | 0 |
| matrix | 200 | 200 | 0 |
| lifecycle | 114 | 114 | 0 |
| validation | 534 | 498 | 36 |
| http | 62 | 62 | 0 |
| effects | 72 | 72 | 0 |
| system | 61 | 57 | 4 |
| contract | 11 | 1 | 10 |
| fixtures (written by the other groups) | 92 | 92 | 0 |

The `contract` group compares the whole run's answers with the OpenAPI document; run it only as part of a
full run.

### 0.10 Problem Details

Application routes answer errors as `application/problem+json`:
`{"type":"/errors/<code>","title","status","code","detail","data"?,"issues"?,"traceId","requestId"}`.
`requestId` equals the `x-request-id` header; `traceId` is a different value by design. Validation errors
have `code: "validation"` and `issues: [{code, message, path}]`. Declared domain errors carry `data`.
Framework errors: 401 `unauthenticated`, 403 `access-denied`, 403 `origin-denied`, 404 `not-found`,
405 `method-not-allowed`, 413 `payload-too-large`, 422 `validation`. `/api/auth/*` answers in Better Auth's
own shape `{"message","code"}` (section 9).

### Result line format

Write each result as `pass`, `fail` or `blocked`, the date, and a note (for `fail`, the report id from
section 10):

```text
- Node: pass · 2026-11-16 · 
- Bun:  fail · 2026-11-16 · see report DRV-05-bun-1
```

---

## 1 Better Auth endpoints the app relies on

Better Auth 1.7.7 with the organization plugin (`src/services/auth/better-auth.ts`). A company is an
organization; the creator becomes `owner`. Answers use Better Auth's shape `{"message","code"}`, not
Problem Details. These items use ad-hoc actor names (`a`, `b`, `c`) instead of the setup script, because
they test the requests the setup script relies on. Prerequisites for every item in this section:

```bash
export BASE=http://127.0.0.1:4110 S=/tmp/relkit-checklist/<ITEM-ID>; mkdir -p "$S"; source scripts/checklist/lib.sh
R=$(date +%s)$((RANDOM % 1000)); P=correct-horse-battery
```

### AUTH-01 · `POST /api/auth/sign-up/email` (sign-up)

- [ ] **AUTH-01** · parallel-safe
- **Who:** anyone. No session needed.
- **Prerequisites:** the block above.
- **Success:**

  ```bash
  call a POST /api/auth/sign-up/email "{\"name\":\"A\",\"email\":\"a-$R@example.test\",\"password\":\"$P\"}" -D "$S/h.txt"; grep -i set-cookie "$S/h.txt"
  ```

  200. Body: `token` (string), `user.id`, `user.email` = the e-mail in lower case, `user.emailVerified: false`.
  Header `set-cookie: better-auth.session_token=…; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | e-mail taken | the success request again with `anon` | 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` |
  | short password | `call anon POST /api/auth/sign-up/email "{\"name\":\"W\",\"email\":\"w-$R@example.test\",\"password\":\"short\"}"` | 400 `PASSWORD_TOO_SHORT` |
  | invalid e-mail | `call anon POST /api/auth/sign-up/email '{"name":"B","email":"not-an-email","password":"correct-horse-battery"}'` | 400 `VALIDATION_ERROR`, `issues[0].path` = `body.email` |
  | missing fields | `call anon POST /api/auth/sign-up/email '{}'` | 400 `VALIDATION_ERROR` naming name, email, password |
  | no `Origin`, no cookie | `NO_ORIGIN=1 call anon POST /api/auth/sign-up/email "{\"name\":\"N\",\"email\":\"n-$R@example.test\",\"password\":\"$P\"}"` | 200 with curl (Node `fetch` gets 403, section 9) |
  | foreign `Origin` | `ORIGIN=https://evil.example call anon POST /api/auth/sign-up/email "{\"name\":\"E\",\"email\":\"e-$R@example.test\",\"password\":\"$P\"}"` | 403 `origin-denied` |
- **Side effects:** `sql "select email from \"user\" where email='a-$R@example.test'"` prints the e-mail;
  `sql "select count(*) from account a join \"user\" u on u.id=a.\"userId\" where u.email='a-$R@example.test'"` prints `1`.
- **Harness:** `--only auth`: `auth:sign-up`, `auth:sign-up-duplicate-email`, `auth:sign-up-weak-password`,
  `auth:sign-up-invalid-email`, `auth:sign-up-missing-fields`, `auth:no-origin-no-cookie-sign-up`;
  `--only validation`: `validation:auth sign-up | *`; `--only actors`: `actors:sign-up-*`.
- **Result:**
  - Node:
  - Bun:

### AUTH-02 · `POST /api/auth/sign-in/email` (sign-in)

- [ ] **AUTH-02** · parallel-safe
- **Who:** anyone with an account.
- **Prerequisites:** sign up user `a` as in AUTH-01, then `call a POST /api/auth/sign-out`.
- **Success:**

  ```bash
  call a POST /api/auth/sign-in/email "{\"email\":\"a-$R@example.test\",\"password\":\"$P\"}"
  ```

  200. Body: `redirect: false`, `token` (string), `user.email`. A new `better-auth.session_token` cookie;
  `json a GET /api/auth/get-session | jq .session.activeOrganizationId` is `null` (a fresh sign-in has no
  active company, even for a member of one).
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | wrong password | `call a POST /api/auth/sign-in/email "{\"email\":\"a-$R@example.test\",\"password\":\"wrong-password-1\"}"` | 401 `INVALID_EMAIL_OR_PASSWORD`, no cookie set |
  | unknown user | same with `"email":"nobody-$R@example.test"` and the right password | 401 `INVALID_EMAIL_OR_PASSWORD` |
  | member signs in again | run [0.6](#06-actors) in this `$S`, then `call member POST /api/auth/sign-in/email "{\"email\":\"${EMAIL_PREFIX}member@example.test\",\"password\":\"$P\"}"`, then `code member GET /vehicles` | 200, then 403 `access-denied` until `set-active` (AUTH-07) |
  | no `Origin`, no cookie | `NO_ORIGIN=1 call anon POST /api/auth/sign-in/email …` | 200 with curl; 403 `MISSING_OR_NULL_ORIGIN` from Node `fetch` (section 9) |
- **Side effects:** `sql "select count(*) from session s join \"user\" u on u.id=s.\"userId\" where u.email='a-$R@example.test'"` grows by 1.
- **Harness:** `--only auth`: `auth:sign-in`, `auth:sign-in-wrong-password`, `auth:sign-in-unknown-user`,
  `auth:member-sign-in-again`, `auth:fresh-sign-in-has-no-active-company`, `auth:fresh-sign-in-company-routes-403`,
  `auth:no-origin-no-cookie-sign-in`; `--only validation`: `validation:auth sign-in | *`.
- **Result:**
  - Node:
  - Bun:

### AUTH-03 · `GET /api/auth/get-session`

- [ ] **AUTH-03** · parallel-safe
- **Who:** anyone; the answer depends on the cookie.
- **Prerequisites:** sign up `a` (AUTH-01).
- **Success:**

  ```bash
  json a GET /api/auth/get-session | jq '{session:(.session|{userId,activeOrganizationId,expiresAt}),user:(.user|{id,email})}'
  ```

  200. `session.userId` = `user.id`; `session.expiresAt` about 7 days ahead; `activeOrganizationId` is
  `null` before a company exists and the company id after AUTH-05 or AUTH-07.
- **Errors and edges:** `call anon GET /api/auth/get-session` → 200 with body `null` (no error status for
  "no session"). After `call a POST /api/auth/sign-out` the same request as `a` → 200 `null`.
- **Side effects:** none.
- **Harness:** `--only auth`: `auth:get-session`, `auth:get-session-after-sign-out`,
  `auth:get-session-active-after-create`; `--only actors`: `actors:owner-session-active-company`,
  `actors:nocompany-session-has-no-active-company`, `actors:anon-has-no-session`.
  `auth:get-session-after-failed-set-active` and `auth:get-session-before-set-active` are in section 9.
- **Result:**
  - Node:
  - Bun:

### AUTH-04 · `POST /api/auth/sign-out`

- [ ] **AUTH-04** · parallel-safe
- **Who:** a signed-in user (without a session it still answers 200).
- **Prerequisites:** sign up `a` (AUTH-01).
- **Success:**

  ```bash
  call a POST /api/auth/sign-out
  ```

  200 `{"success":true}`; the jar's session cookie is cleared; `json a GET /api/auth/get-session` → `null`.
- **Errors and edges:** without `Origin` and with the cookie: `NO_ORIGIN=1 call a POST /api/auth/sign-out` →
  403 `MISSING_OR_NULL_ORIGIN` (sign in again first).
- **Side effects:** the session row is gone:
  `sql "select count(*) from session s join \"user\" u on u.id=s.\"userId\" where u.email='a-$R@example.test'"` → `0`.
- **Harness:** `--only auth`: `auth:sign-out`, `auth:member-sign-out`.
- **Result:**
  - Node:
  - Bun:

### AUTH-05 · `POST /api/auth/organization/create` (create a company)

- [ ] **AUTH-05** · parallel-safe
- **Who:** any signed-in user (401 without a session).
- **Prerequisites:** sign up `a` (AUTH-01).
- **Success:**

  ```bash
  json a POST /api/auth/organization/create "{\"name\":\"Auth Co $R\",\"slug\":\"auth-$R\",\"legalName\":\"Auth Co LLC\",\"taxId\":\"TX-1\",\"phone\":\"+20100000000\",\"address\":\"1 Nile\",\"country\":\"EG\"}" | tee "$S/org.json" | jq '{id,name,slug,legalName,taxId,phone,address,country,members:[.members[]|{role,userId}]}'
  ORG=$(jq -r .id "$S/org.json")
  ```

  200. Echoes `name`, `slug` and the five additional fields (`legalName`, `taxId`, `phone`, `address`,
  `country`); `members` has one entry with `role: "owner"` and the creator's `userId`. The new company
  becomes the creator's active company: `json a GET /api/auth/get-session | jq -r .session.activeOrganizationId` = `$ORG`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | slug taken | `call a POST /api/auth/organization/create "{\"name\":\"Copy\",\"slug\":\"auth-$R\"}"` | 400 `ORGANIZATION_ALREADY_EXISTS` |
  | no session | `call anon POST /api/auth/organization/create '{"name":"X","slug":"anon-x"}'` | 401, empty body |
- **Side effects:** `sql "select role from member where \"organizationId\"='$ORG'"` → `owner`;
  `sql "select \"legalName\", country from organization where id='$ORG'"` → `Auth Co LLC|EG`.
- **Harness:** `--only auth`: `auth:organization-create`, `auth:organization-create-duplicate-slug`,
  `auth:organization-create-no-session`; `--only actors`: `actors:company-A-create`, `actors:company-B-create`.
- **Result:**
  - Node:
  - Bun:

### AUTH-06 · `GET /api/auth/organization/list` (list my companies)

- [ ] **AUTH-06** · parallel-safe
- **Who:** signed-in users; 401 otherwise.
- **Prerequisites:** run [0.6](#06-actors) in this `$S` (then `source "$S/ids.env"`).
- **Success:**

  ```bash
  json dispatcher GET /api/auth/organization/list | jq '[.[]|{id,slug}]'
  ```

  200. An array with exactly one company, `id` = `$COMPANY_A`. As `ownerB` it lists only `$COMPANY_B`; as
  `nocompany` it is `[]`.
- **Errors and edges:** `call anon GET /api/auth/organization/list` → 401 `{"message":"Unauthorized","code":"UNAUTHORIZED"}`.
- **Side effects:** none.
- **Harness:** `--only auth`: `auth:organization-list`; `--only actors`: `actors:list-organizations-admin`,
  `-dispatcher`, `-driver`, `-member`.
- **Result:**
  - Node:
  - Bun:

### AUTH-07 · `POST /api/auth/organization/set-active` (choose the active company)

- [ ] **AUTH-07** · parallel-safe
- **Who:** a member of the company. Application routes take the tenant only from the session's active company.
- **Prerequisites:** run [0.6](#06-actors) in this `$S`. Then make the member's session fresh:
  `call member POST /api/auth/sign-in/email "{\"email\":\"${EMAIL_PREFIX}member@example.test\",\"password\":\"$PASSWORD\"}"`.
- **Success:**

  ```bash
  code member GET /vehicles                      # 403 before
  call member POST /api/auth/organization/set-active "{\"organizationId\":\"$COMPANY_A\"}"
  code member GET /vehicles                      # 200 after
  ```

  200 with the company (`id` = `$COMPANY_A`, `name`, `slug`, additional fields); then `GET /vehicles`
  answers 200 where it answered 403 `access-denied` before.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | unknown company | `call owner POST /api/auth/organization/set-active '{"organizationId":"does-not-exist"}'` | 403 `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`; afterwards the owner's active company is `null` (section 9) — restore it with the success request as `owner` |
  | another company | `call ownerB POST /api/auth/organization/set-active "{\"organizationId\":\"$COMPANY_A\"}"` | 403 `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` |
  | no session | `call anon POST /api/auth/organization/set-active "{\"organizationId\":\"$COMPANY_A\"}"` | 401 |
  | session, no `Origin` | `NO_ORIGIN=1 call owner POST /api/auth/organization/set-active "{\"organizationId\":\"$COMPANY_A\"}"` | 403 `MISSING_OR_NULL_ORIGIN` |
  | session, foreign `Origin` | `ORIGIN=https://evil.example call owner POST …` (same body) | 403 `origin-denied` |
- **Side effects:** `sql "select \"activeOrganizationId\" from session where \"userId\"='$MEMBER_ID' order by \"createdAt\" desc limit 1"` = `$COMPANY_A`.
- **Harness:** `--only auth`: `auth:set-active`, `auth:set-active-unknown-org`, `auth:set-active-restore`,
  `auth:set-active-foreign-org`, `auth:set-active-member`, `auth:member-vehicle-models-read`,
  `auth:no-origin-with-session`, `auth:foreign-origin-with-session`; `--only actors`: `actors:set-active-*`, `actors:role-check-*`.
- **Result:**
  - Node:
  - Bun:

### AUTH-08 · `POST /api/auth/organization/invite-member`

- [ ] **AUTH-08** · parallel-safe
- **Who:** `owner` and `admin` of the active company (`invitation:create`); a dispatcher, driver or member
  cannot invite.
- **Prerequisites:** sign up `a` and create company `$ORG` (AUTH-05); sign up `b` with e-mail `b-$R@example.test`.
- **Success:**

  ```bash
  json a POST /api/auth/organization/invite-member "{\"email\":\"b-$R@example.test\",\"role\":\"dispatcher\"}" | tee "$S/inv.json" | jq '{id,role,status,email,organizationId,expiresAt}'
  INV=$(jq -r .id "$S/inv.json")
  ```

  200. `role: "dispatcher"`, `status: "pending"`, `email` = the invitee, `organizationId` = `$ORG`,
  `expiresAt` 48 hours ahead. Each of the five roles is accepted: `owner`, `admin`, `dispatcher`, `driver`, `member`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | already invited | the success request again | 400 `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION` |
  | unknown role | `call a POST /api/auth/organization/invite-member "{\"email\":\"x-$R@example.test\",\"role\":\"superuser\"}"` | 400 `{"message":"ROLE_NOT_FOUND: superuser"}` |
  | no session | `call anon POST /api/auth/organization/invite-member "{\"email\":\"x-$R@example.test\",\"role\":\"member\"}"` | 401 `UNAUTHORIZED` |
  | caller not a member | `call b POST /api/auth/organization/invite-member "{\"email\":\"y-$R@example.test\",\"role\":\"member\",\"organizationId\":\"$ORG\"}"` | 400 `MEMBER_NOT_FOUND` |
  | caller is a dispatcher | after AUTH-09 as `b`: `call b POST /api/auth/organization/invite-member "{\"email\":\"z-$R@example.test\",\"role\":\"member\"}"` | 403 (Better Auth permission refusal) |
- **Side effects:** `sql "select role, status from invitation where id='$INV'"` → `dispatcher|pending`.
- **Harness:** `--only auth`: `auth:invite-member`, `auth:invite-member-duplicate`, `auth:invite-member-invalid-role`,
  `auth:invite-member-as-non-member`; `--only actors`: `actors:invite-admin`, `-dispatcher`, `-driver`, `-member`.
- **Result:**
  - Node:
  - Bun:

### AUTH-09 · `POST /api/auth/organization/accept-invitation`

- [ ] **AUTH-09** · parallel-safe
- **Who:** the invited user only (the invitation's e-mail).
- **Prerequisites:** AUTH-08's prerequisites and success request (`$ORG`, `$INV`); sign up `c` with another e-mail.
- **Success:**

  ```bash
  json b POST /api/auth/organization/accept-invitation "{\"invitationId\":\"$INV\"}" | jq '{member:(.member|{role,organizationId,userId}),invitation:(.invitation|{status})}'
  json b GET /api/auth/get-session | jq -r .session.activeOrganizationId
  ```

  200. `member.role: "dispatcher"`, `member.organizationId` = `$ORG`, `invitation.status: "accepted"`.
  Accepting also makes `$ORG` the active company of `b`'s session (the second command prints `$ORG`).
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | another user | `call c POST /api/auth/organization/accept-invitation "{\"invitationId\":\"$INV\"}"` (before `b` accepts) | 403 `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION` |
  | accepted twice | the success request again | 400 `INVITATION_NOT_FOUND` |
  | unknown id | `call b POST /api/auth/organization/accept-invitation '{"invitationId":"nope"}'` | 400 `INVITATION_NOT_FOUND` |
- **Side effects:** `sql "select role from member where \"organizationId\"='$ORG' and \"userId\"=(select id from \"user\" where email='b-$R@example.test')"` → `dispatcher`;
  `sql "select status from invitation where id='$INV'"` → `accepted`.
- **Harness:** `--only auth`: `auth:accept-invitation-wrong-user`, `auth:accept-invitation`,
  `auth:accept-invitation-again`; `--only actors`: `actors:accept-*`. `auth:get-session-before-set-active` is in section 9.
- **Result:**
  - Node:
  - Bun:

---

## 2 Fleet: vehicle models and vehicles

Prerequisites for every item from here on: [0.5](#05-shell-helpers-and-the-origin-rule) and
[0.6](#06-actors) in the item's own `$S`, then the fixtures named in the item.

**Role table** (from `src/services/auth/permissions.ts`, confirmed by the `matrix` group). "B" is
`ownerB`, an owner of another company: collection routes act on company B, and an id from company A is
answered 404 with the domain code. `nocompany` gets 403 `access-denied` and `anon` 401 `unauthenticated` on
every route of sections 2 to 4.

| Route | Permission | owner | admin | dispatcher | driver | member |
|---|---|---|---|---|---|---|
| `GET /vehicle-models` | `vehicleModel:read` | 200 | 200 | 200 | 200 | 200 |
| `POST /vehicle-models` | `vehicleModel:create` | 201 | 201 | 403 | 403 | 403 |
| `PATCH /vehicle-models/{modelId}` | `vehicleModel:update` | 200 | 200 | 403 | 403 | 403 |
| `DELETE /vehicle-models/{modelId}` | `vehicleModel:delete` | 200 | 200 | 403 | 403 | 403 |
| `GET /vehicles` | `vehicle:read` | 200 | 200 | 200 | 200 | 200 |
| `POST /vehicles` | `vehicle:create` | 201 | 201 | 403 | 403 | 403 |
| `GET /vehicles/{vehicleId}` | `vehicle:read` | 200 | 200 | 200 | 200 | 200 |
| `PATCH /vehicles/{vehicleId}` | `vehicle:update` | 200 | 200 | 200 | 403 | 403 |
| `PUT /vehicles/{vehicleId}/status` | `vehicle:changeStatus` | 200 | 200 | 200 | 403 | 403 |
| `POST /vehicles/{vehicleId}/retire` | `vehicle:delete` | 200 | 200 | 403 | 403 | 403 |

The `matrix` group checks every cell above for every route of sections 2 to 4, plus `ownerB`, `nocompany`
and `anon`: row ids `matrix:<METHOD> <path> | <actor>`, for example `matrix:POST /vehicles | dispatcher`.

### MODEL-01 · `GET /vehicle-models` (list models)

- [ ] **MODEL-01** · parallel-safe · function `fleet.list-models`
- **Who:** see the role table (read: all five roles).
- **Prerequisites:** F-MODEL.
- **Success:**

  ```bash
  call member GET '/vehicle-models?limit=10&offset=0'
  ```

  200. `{"items":[…],"limit":10,"offset":0}`; `items[0].id` = `$M`, newest first; each item has `id`,
  `make`, `name`, `bodyType`, `capacityKg`, `createdAt`, `updatedAt` and no `organizationId`.
  As `ownerB`: `items` does not contain `$M`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | limit out of range | `call owner GET '/vehicle-models?limit=0'`, `?limit=101`, `?limit=-1`, `?limit=abc`, `?limit=1.5` | 422 `validation`, `issues[0].path` = `["limit"]` |
  | offset invalid | `?offset=-1`, `?offset=abc` | 422 `validation` |
  | default page | `call owner GET /vehicle-models` | 200, `limit: 50`, `offset: 0` |
  | repeated parameter | `?limit=10&limit=20` | 422 `validation` |
  | lenient numbers | `?limit=1e2`, `?limit=0x10` | 200 with `limit` 100 and 16 (section 9) |
  | unknown parameter | `?unknown=1` | 200, ignored |
  | anonymous / no company | `call anon GET /vehicle-models`; `call nocompany GET /vehicle-models` | 401 `unauthenticated`; 403 `access-denied` |
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /vehicle-models | *`; `--only lifecycle`: `lifecycle:models/list`,
  `models/list-page-size-2`, `models/list-offset-beyond-end`; `--only validation`: `validation:GET /vehicle-models?*` (19 rows).
- **Result:**
  - Node:
  - Bun:

### MODEL-02 · `POST /vehicle-models` (create a model)

- [ ] **MODEL-02** · parallel-safe · function `fleet.create-model`
- **Who:** owner, admin (201); dispatcher, driver, member, nocompany 403 `access-denied`; anon 401.
- **Prerequisites:** setup only.
- **Success:**

  ```bash
  call owner POST /vehicle-models '{"make":"Isuzu","name":"NPR","bodyType":"box_truck","capacityKg":3500}'
  ```

  201. `id` (UUID), `make`, `name`, `bodyType`, `capacityKg` as sent; `createdAt` = `updatedAt` (ISO 8601).
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | same make and name | the success request again | 409 `fleet.model-exists`, `data: {make, name}` |
  | invalid body type, capacity 0 | `call owner POST /vehicle-models '{"make":"Isuzu","name":"X","bodyType":"plane","capacityKg":0}'` | 422 `validation`, issues on `bodyType` and `capacityKg` |
  | limits | `make`/`name` empty or over 60 characters; `capacityKg` 100001 or 1.5 | 422 `validation` |
  | NUL character | `call owner POST /vehicle-models '{"make":"Isuzu","name":"A\u0000B","bodyType":"van","capacityKg":10}'` | 422 `validation` ("Must not contain a NUL character") |
  | malformed JSON | `call owner POST /vehicle-models '{bad json'` | 422 `validation`, issue `malformed-json` (section 9) |
  | role | `call dispatcher POST /vehicle-models '{"make":"Isuzu","name":"Y","bodyType":"van","capacityKg":10}'` | 403 `access-denied` |
  | foreign `Origin` | `ORIGIN=https://evil.example call owner POST /vehicle-models '{"make":"Isuzu","name":"Z","bodyType":"van","capacityKg":10}'` | 403 `origin-denied` |
  | body over 1 MiB (`maxBodyBytes` 1,048,576) | the two commands below the table | 413 `payload-too-large` |

  ```bash
  head -c 1100000 /dev/zero | tr '\0' a | sed 's/^/{"make":"/; s/$/"}/' > "$S/big.json"
  call owner POST /vehicle-models --data-binary @"$S/big.json" -H 'Content-Type: application/json'
  ```
- **Side effects:** `sql "select make, name, \"organizationId\" from vehicle_model where id='<id>'"` → `Isuzu|NPR|$COMPANY_A`.
- **Harness:** `--only matrix`: `matrix:POST /vehicle-models | *`; `--only lifecycle`: `lifecycle:models/create`,
  `models/create-duplicate`, `models/create-case-variant`; `--only validation`: `validation:POST /vehicle-models | *` (46 rows).
- **Result:**
  - Node:
  - Bun:

### MODEL-03 · `PATCH /vehicle-models/{modelId}` (update a model)

- [ ] **MODEL-03** · parallel-safe · function `fleet.update-model`
- **Who:** owner, admin (200); dispatcher, driver, member 403; ownerB 404 `fleet.model-not-found`; anon 401.
- **Prerequisites:** F-MODEL, and a second model:
  `M2=$(json owner POST /vehicle-models '{"make":"Isuzu","name":"Z","bodyType":"van","capacityKg":10}' | jq -r .id)`.
- **Success:**

  ```bash
  call owner PATCH /vehicle-models/$M '{"capacityKg":4000}'
  ```

  200. `capacityKg: 4000`, other fields unchanged, `updatedAt` later than `createdAt`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | unknown id | `call owner PATCH /vehicle-models/nope '{"capacityKg":4000}'` | 404 `fleet.model-not-found`, `data.modelId: "nope"` |
  | clash with another model | `call owner PATCH /vehicle-models/$M '{"make":"Isuzu","name":"Z"}'` | 409 `fleet.model-exists` |
  | empty patch | `call owner PATCH /vehicle-models/$M '{}'` | 200, only `updatedAt` changes |
  | other company | `call ownerB PATCH /vehicle-models/$M '{"capacityKg":1}'` | 404 `fleet.model-not-found` |
  | invalid values | `'{"bodyType":"plane"}'`, `'{"capacityKg":0}'` | 422 `validation` |
- **Side effects:** `sql "select \"capacityKg\" from vehicle_model where id='$M'"` → `4000`.
- **Harness:** `--only matrix`: `matrix:PATCH /vehicle-models/:id | *`; `--only lifecycle`: `lifecycle:models/update`,
  `models/update-empty-patch`, `models/update-clash`, `models/update-unknown`; `--only validation`: `validation:PATCH /vehicle-models/:id | *` (35 rows).
- **Result:**
  - Node:
  - Bun:

### MODEL-04 · `DELETE /vehicle-models/{modelId}` (delete an unused model)

- [ ] **MODEL-04** · parallel-safe · function `fleet.delete-model`
- **Who:** owner, admin (200); dispatcher, driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE (so `$M` is in use), and an unused model:
  `M2=$(json owner POST /vehicle-models '{"make":"Ford","name":"Transit","bodyType":"van","capacityKg":1200}' | jq -r .id)`.
- **Success:**

  ```bash
  call owner DELETE /vehicle-models/$M2
  ```

  200 `{"deleted":true}`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | deleted twice / unknown | the success request again; `call owner DELETE /vehicle-models/nope` | 404 `fleet.model-not-found` |
  | model in use | `call owner DELETE /vehicle-models/$M` | 409 `fleet.model-in-use`, `data: {modelId, vehicles: 1}` |
  | in use by a retired vehicle only | `code owner POST /vehicles/$V/retire`, then `call owner DELETE /vehicle-models/$M` | still 409 `fleet.model-in-use` (retired vehicles keep their model) |
  | role | `call dispatcher DELETE /vehicle-models/$M2` | 403 `access-denied` |
- **Side effects:** `sql "select count(*) from vehicle_model where id='$M2'"` → `0`.
- **Harness:** `--only matrix`: `matrix:DELETE /vehicle-models/:id | *`; `--only lifecycle`: `lifecycle:models/delete-unknown`,
  `models/delete-in-use`, `models/delete-unused`, `models/delete-again`, `models/delete-with-retired-vehicle`;
  `--only validation`: `validation:DELETE /vehicle-models/:id | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### VEH-01 · `GET /vehicles` (list vehicles)

- [ ] **VEH-01** · parallel-safe · function `fleet.list-vehicles`
- **Who:** all five roles 200; nocompany 403; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, and a vehicle in maintenance:
  `V2=$(json owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"CK 2\",\"year\":2023}" | jq -r .id); code owner PUT /vehicles/$V2/status '{"status":"maintenance"}'`.
- **Success:**

  ```bash
  call driver GET "/vehicles?status=active&modelId=$M&limit=10"
  ```

  200. `items` holds `$V` only (status `active`), `limit: 10`, `offset: 0`; `?status=maintenance` holds `$V2` only;
  without filters both, newest first. Items have no `organizationId`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | unknown status | `call owner GET '/vehicles?status=flying'`; `?status=ACTIVE`; `?status=` | 422 `validation` |
  | empty model filter | `call owner GET '/vehicles?modelId='` | 422 `validation` |
  | two statuses | `?status=active&status=retired` | 422 `validation` |
  | paging | as MODEL-01 (`limit` 1 to 100, `offset` ≥ 0) | 422 `validation` outside the range |
  | other company | `call ownerB GET /vehicles` | 200, `items` without `$V` |
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /vehicles | *`; `--only lifecycle`: `lifecycle:vehicles/list-filter-status`,
  `vehicles/list-filter-model`; `--only validation`: `validation:GET /vehicles?*` (24 rows).
- **Result:**
  - Node:
  - Bun:

### VEH-02 · `POST /vehicles` (register a vehicle)

- [ ] **VEH-02** · parallel-safe · function `fleet.create-vehicle`
- **Who:** owner, admin 201; dispatcher, driver, member 403; ownerB 404 `fleet.model-not-found` (A's model); anon 401.
- **Prerequisites:** F-MODEL.
- **Success:**

  ```bash
  call owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"abc  123\",\"vin\":\"1HGCM82633A004352\",\"year\":2022}"
  ```

  201. `plate: "ABC 123"` (upper case, single spaces), `vin` as sent in upper case, `year: 2022`,
  `status: "active"`, `modelId` = `$M`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | plate taken (after normalising) | `call owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"ABC 123\",\"year\":2022}"` | 409 `fleet.plate-taken`, `data.plate: "ABC 123"` |
  | VIN taken | `call owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"XYZ 9\",\"vin\":\"1HGCM82633A004352\",\"year\":2022}"` | 409 `fleet.vin-taken` |
  | unknown model | `call owner POST /vehicles '{"modelId":"nope","plate":"QQ 1","year":2022}'` | 404 `fleet.model-not-found` |
  | invalid VIN, year | `call owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"QQ 2\",\"vin\":\"IOQ\",\"year\":1970}"` | 422 `validation`: "VIN must be 17 characters (no I, O or Q)", year ≥ 1980 |
  | year too late | `year` = next year + 2 | 422 `validation` (maximum is next year) |
  | plate length | `"plate":"A"` or 17 characters | 422 `validation` (2 to 16 after trimming) |
  | two vehicles without VIN | two creates without `vin`, different plates | 201 both (`vin: null`) |
  | body exactly 1 MiB / over | see `validation:POST /vehicles | body = maxBodyBytes exactly` | 201 / 413 `payload-too-large` |
- **Side effects:** `sql "select plate, status from vehicle where \"organizationId\"='$COMPANY_A'"` → `ABC 123|active`.
- **Harness:** `--only matrix`: `matrix:POST /vehicles | *`; `--only lifecycle`: `lifecycle:vehicles/create`,
  `vehicles/create-plate-taken`, `vehicles/create-vin-taken`, `vehicles/create-model-not-found`,
  `vehicles/create-invalid-vin`, `vehicles/create-without-vin-twice-1`, `-2`; `--only validation`: `validation:POST /vehicles | *` (43 rows).
- **Result:**
  - Node:
  - Bun:

### VEH-03 · `GET /vehicles/{vehicleId}` (one vehicle)

- [ ] **VEH-03** · parallel-safe · function `fleet.get-vehicle`
- **Who:** all five roles 200; ownerB 404 `fleet.vehicle-not-found`; nocompany 403; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE.
- **Success:**

  ```bash
  call driver GET /vehicles/$V
  ```

  200. The vehicle with `id` = `$V`, `plate: "CK 1"`, `status: "active"`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | unknown id | `call owner GET /vehicles/nope` | 404 `fleet.vehicle-not-found`, `data.vehicleId: "nope"` |
  | other company | `call ownerB GET /vehicles/$V` | 404 `fleet.vehicle-not-found` (not 403: tenants never see each other) |
  | NUL in id | `call owner GET /vehicles/a%00b` | 422 `validation` |
  | retired vehicle | after `code owner POST /vehicles/$V/retire` | 200, `status: "retired"` |
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /vehicles/:id | *`; `--only lifecycle`: `lifecycle:vehicles/get`,
  `vehicles/get-unknown`, `vehicles/get-after-retire`; `--only validation`: `validation:GET /vehicles/:id | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### VEH-04 · `PATCH /vehicles/{vehicleId}` (update a vehicle)

- [ ] **VEH-04** · parallel-safe · function `fleet.update-vehicle`
- **Who:** owner, admin, dispatcher 200; driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, a second vehicle with a VIN:
  `V2=$(json owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"CK 2\",\"vin\":\"1HGCM82633A004352\",\"year\":2022}" | jq -r .id)`.
- **Success:**

  ```bash
  call dispatcher PATCH /vehicles/$V '{"year":2023,"plate":"ck  7"}'
  ```

  200. `year: 2023`, `plate: "CK 7"`, `status` unchanged.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | plate taken | `call owner PATCH /vehicles/$V '{"plate":"CK 2"}'` | 409 `fleet.plate-taken` |
  | VIN taken | `call owner PATCH /vehicles/$V '{"vin":"1HGCM82633A004352"}'` | 409 `fleet.vin-taken` |
  | unknown model | `call owner PATCH /vehicles/$V '{"modelId":"nope"}'` | 404 `fleet.model-not-found` |
  | unknown vehicle | `call owner PATCH /vehicles/nope '{"year":2023}'` | 404 `fleet.vehicle-not-found` |
  | same plate again | `call owner PATCH /vehicles/$V2 '{"plate":"CK 2"}'` | 200 |
  | retired | `code owner POST /vehicles/$V/retire`, then `call owner PATCH /vehicles/$V '{"year":2024}'` | 409 `fleet.vehicle-retired` |
  | status in body | `call owner PATCH /vehicles/$V2 '{"status":"retired"}'` | 200 and `status` unchanged (unknown fields are ignored) |
  | role | `call driver PATCH /vehicles/$V2 '{"year":2023}'` | 403 `access-denied` |
- **Side effects:** `sql "select plate, year from vehicle where id='$V'"`.
- **Harness:** `--only matrix`: `matrix:PATCH /vehicles/:id | *`; `--only lifecycle`: `lifecycle:vehicles/update`,
  `vehicles/update-plate-taken`, `vehicles/update-vin-taken`, `vehicles/update-model-not-found`,
  `vehicles/update-unknown`, `vehicles/update-same-plate`, `vehicles/update-after-retire`;
  `--only validation`: `validation:PATCH /vehicles/:id | *` (35 rows).
- **Result:**
  - Node:
  - Bun:

### VEH-05 · `PUT /vehicles/{vehicleId}/status` (active ⇄ maintenance)

- [ ] **VEH-05** · parallel-safe · function `fleet.change-vehicle-status` · publishes `fleet.vehicle-status-changed` and the realtime event `changed`
- **Who:** owner, admin, dispatcher 200; driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE.
- **Success:**

  ```bash
  call dispatcher PUT /vehicles/$V/status '{"status":"maintenance"}'
  ```

  200. `status: "maintenance"`; `updatedAt` changes. Back with `'{"status":"active"}'` → 200.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | same status | the success request twice | second: 409 `fleet.invalid-status-transition`, `data: {from: "maintenance", to: "maintenance"}` |
  | `retired` via this route | `call owner PUT /vehicles/$V/status '{"status":"retired"}'` | 422 `validation` (only `active` and `maintenance`) |
  | after retirement | `code owner POST /vehicles/$V/retire`, then `'{"status":"active"}'` | 409 `fleet.invalid-status-transition`, `from: "retired"` |
  | unknown vehicle | `call owner PUT /vehicles/nope/status '{"status":"active"}'` | 404 `fleet.vehicle-not-found` |
  | missing status | `call owner PUT /vehicles/$V/status '{}'` | 422 `validation` |
- **Side effects:** `sql "select status from vehicle where id='$V'"`; the event reaction (EVT-01) and the
  realtime frame (RT-01) follow from this route.
- **Harness:** `--only matrix`: `matrix:PUT /vehicles/:id/status | *`; `--only lifecycle`: `lifecycle:vehicles/status-maintenance`,
  `vehicles/status-maintenance-again`, `vehicles/status-active`, `vehicles/status-retired-via-status-endpoint`,
  `vehicles/status-unknown`, `vehicles/status-after-retire`; `--only validation`: `validation:PUT /vehicles/:id/status | *` (33 rows).
- **Result:**
  - Node:
  - Bun:

### VEH-06 · `POST /vehicles/{vehicleId}/retire` (retire permanently)

- [ ] **VEH-06** · parallel-safe · function `fleet.retire-vehicle` · publishes `fleet.vehicle-status-changed` and `changed`
- **Who:** owner, admin 200; dispatcher, driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE.
- **Success:**

  ```bash
  call owner POST /vehicles/$V/retire
  ```

  200. `status: "retired"`. No request body is needed.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | twice | the success request again | 409 `fleet.invalid-status-transition`, `from: "retired"`, `to: "retired"` |
  | unknown | `call owner POST /vehicles/nope/retire` | 404 `fleet.vehicle-not-found` |
  | role | `call dispatcher POST /vehicles/$V/retire` | 403 `access-denied` |
  | from maintenance | a vehicle in maintenance, then retire | 200 (retirement wins over any status) |
- **Side effects:** `sql "select status from vehicle where id='$V'"` → `retired`; an open assignment of
  `$V` is closed by the reaction (EVT-02).
- **Harness:** `--only matrix`: `matrix:POST /vehicles/:id/retire | *`; `--only lifecycle`: `lifecycle:vehicles/retire`,
  `vehicles/retire-again`, `vehicles/retire-unknown`; `--only validation`: `validation:POST /vehicles/:id/retire | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

---

## 3 Drivers and assignments

| Route | Permission | owner | admin | dispatcher | driver | member |
|---|---|---|---|---|---|---|
| `GET /drivers` | `driver:read` | 200 | 200 | 200 | 200 | 200 |
| `POST /drivers` | `driver:create` | 201 | 201 | 403 | 403 | 403 |
| `GET /drivers/{driverId}` | `driver:read` | 200 | 200 | 200 | 200 | 200 |
| `PATCH /drivers/{driverId}` | `driver:update` | 200 | 200 | 403 | 403 | 403 |
| `POST /drivers/{driverId}/activate` | `driver:update` | 200 | 200 | 403 | 403 | 403 |
| `POST /drivers/{driverId}/deactivate` | `driver:delete` | 200 | 200 | 403 | 403 | 403 |
| `DELETE /drivers/{driverId}/vehicle` | `assignment:delete` | 200 | 200 | 200 | 403 | 403 |
| `GET /driver-assignments` | `assignment:read` | 200 | 200 | 200 | 200 | 200 |
| `POST /driver-assignments` | `assignment:create` | 201 | 201 | 201 | 403 | 403 |

`ownerB` with an id of company A gets 404 (`drivers.driver-not-found`, `drivers.no-open-assignment`).

### DRV-01 · `GET /drivers` (list drivers)

- [ ] **DRV-01** · parallel-safe · function `drivers.list-drivers`
- **Who:** all five roles 200; nocompany 403; anon 401.
- **Prerequisites:** F-DRIVER, and an inactive driver:
  `D2=$(json owner POST /drivers '{"fullName":"Second","phone":"+201001234567","licenseNumber":"CK-0002","licenseClass":"B","licenseExpiresOn":"2030-01-01"}' | jq -r .id); code owner POST /drivers/$D2/deactivate`.
- **Success:**

  ```bash
  call member GET '/drivers?status=active&limit=10'
  ```

  200. `items` holds `$D` only; `?status=inactive` holds `$D2` only. Items: `id`, `userId` (null),
  `fullName`, `phone`, `licenseNumber` (upper case), `licenseClass`, `licenseExpiresOn`, `status`, timestamps.
- **Errors and edges:** `?status=flying`, `?status=` → 422 `validation`; paging as MODEL-01.
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /drivers | *`; `--only lifecycle`: `lifecycle:drivers/list`,
  `drivers/list-inactive`; `--only validation`: `validation:GET /drivers?*` (21 rows).
- **Result:**
  - Node:
  - Bun:

### DRV-02 · `POST /drivers` (register a driver)

- [ ] **DRV-02** · parallel-safe · function `drivers.create-driver`
- **Who:** owner, admin 201; dispatcher, driver, member 403; ownerB 201 (in company B); anon 401.
- **Prerequisites:** setup only.
- **Success:**

  ```bash
  call owner POST /drivers '{"fullName":"Ali Hassan","phone":"+201001234567","licenseNumber":"eg-123456","licenseClass":"b","licenseExpiresOn":"2030-01-01"}'
  ```

  201. `licenseNumber: "EG-123456"`, `licenseClass: "B"` (upper case), `status: "active"`, `userId: null`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | license taken | the success request again with another `fullName` | 409 `drivers.license-taken`, `data.licenseNumber: "EG-123456"` |
  | expired license | `call owner POST /drivers '{"fullName":"Old","phone":"+201001234567","licenseNumber":"OLD-1","licenseClass":"B","licenseExpiresOn":"2020-01-01"}'` | 422 `drivers.license-expired` |
  | link a member's login | `call owner POST /drivers "{\"fullName\":\"Linked\",\"phone\":\"+201001234567\",\"licenseNumber\":\"LNK-1\",\"licenseClass\":\"B\",\"licenseExpiresOn\":\"2030-01-01\",\"userId\":\"$DRIVER_ID\"}"` | 201, `userId` = `$DRIVER_ID` |
  | same login twice | the previous request with `"licenseNumber":"LNK-2"` | 409 `drivers.user-already-driver` |
  | login of another company | `userId` = `$OWNERB_ID` | 422 `drivers.user-not-in-company` |
  | invalid fields | `call owner POST /drivers '{"fullName":"X","phone":"abc","licenseNumber":"1","licenseClass":"","licenseExpiresOn":"2030-02-30"}'` | 422 `validation` on all five fields ("Not a real calendar date") |
- **Side effects:** `sql "select \"licenseNumber\", status from driver where \"organizationId\"='$COMPANY_A'"`.
- **Harness:** `--only matrix`: `matrix:POST /drivers | *`; `--only lifecycle`: `lifecycle:drivers/create`,
  `drivers/create-license-expired`, `drivers/create-license-taken`, `drivers/create-user-not-in-company`,
  `drivers/create-user-unknown`, `drivers/create-linked-to-member`, `drivers/create-user-already-driver`;
  `--only validation`: `validation:POST /drivers | *` (52 rows).
- **Result:**
  - Node:
  - Bun:

### DRV-03 · `GET /drivers/{driverId}` (one driver)

- [ ] **DRV-03** · parallel-safe · function `drivers.get-driver`
- **Who:** all five roles 200; ownerB 404 `drivers.driver-not-found`; nocompany 403; anon 401.
- **Prerequisites:** F-DRIVER.
- **Success:** `call member GET /drivers/$D` → 200, `id` = `$D`, `licenseNumber: "CK-0001"`.
- **Errors and edges:** `call owner GET /drivers/nope` → 404 `drivers.driver-not-found`, `data.driverId: "nope"`;
  `call ownerB GET /drivers/$D` → 404 `drivers.driver-not-found`.
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /drivers/:id | *`; `--only lifecycle`: `lifecycle:drivers/get`,
  `drivers/get-unknown`; `--only validation`: `validation:GET /drivers/:id | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### DRV-04 · `PATCH /drivers/{driverId}` (update a driver)

- [ ] **DRV-04** · parallel-safe · function `drivers.update-driver`
- **Who:** owner, admin 200; dispatcher, driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-DRIVER and a second driver with license `CK-0002` (see DRV-01).
- **Success:**

  ```bash
  call owner PATCH /drivers/$D '{"phone":"+20 100 999 8888","licenseClass":"c"}'
  ```

  200. `phone: "+20 100 999 8888"`, `licenseClass: "C"`, `status` unchanged.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | license taken | `call owner PATCH /drivers/$D '{"licenseNumber":"CK-0002"}'` | 409 `drivers.license-taken` |
  | expired license | `call owner PATCH /drivers/$D '{"licenseExpiresOn":"2001-01-01"}'` | 422 `drivers.license-expired` |
  | unknown | `call owner PATCH /drivers/nope '{"phone":"+201001234567"}'` | 404 `drivers.driver-not-found` |
  | status in body | `'{"status":"inactive"}'` | 200, `status` unchanged (ignored) |
  | invalid phone | `'{"phone":"abc"}'` | 422 `validation` ("Enter a valid phone number") |
- **Side effects:** `sql "select phone, \"licenseClass\" from driver where id='$D'"`.
- **Harness:** `--only matrix`: `matrix:PATCH /drivers/:id | *`; `--only lifecycle`: `lifecycle:drivers/update`,
  `drivers/update-license-taken`, `drivers/update-license-expired`, `drivers/update-unknown`;
  `--only validation`: `validation:PATCH /drivers/:id | *` (35 rows).
- **Result:**
  - Node:
  - Bun:

### DRV-05 · `POST /drivers/{driverId}/activate`

- [ ] **DRV-05** · parallel-safe · function `drivers.activate-driver`
- **Who:** owner, admin 200; dispatcher, driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-DRIVER, then `code owner POST /drivers/$D/deactivate` (200).
- **Success:** `call admin POST /drivers/$D/activate` → 200, `status: "active"`. Activating an active driver also answers 200.
- **Errors and edges:**
  - Unknown driver: `call owner POST /drivers/nope/activate` → 404 `drivers.driver-not-found`.
  - License expired since registration: the API refuses expired dates, so set one in the database (the
    only write to the database in this checklist; it touches only this item's driver), deactivate, then
    activate → 422 `drivers.license-expired`:

    ```bash
    psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -c "update driver set \"licenseExpiresOn\"='2001-01-01' where id='$D'"
    code owner POST /drivers/$D/deactivate
    call owner POST /drivers/$D/activate
    ```
- **Side effects:** `sql "select status from driver where id='$D'"` → `active`.
- **Harness:** `--only matrix`: `matrix:POST /drivers/:id/activate | *`; `--only lifecycle`: `lifecycle:drivers/activate`,
  `drivers/activate-unknown`; `--only validation`: `validation:POST /drivers/:id/activate | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### DRV-06 · `POST /drivers/{driverId}/deactivate` (deactivate and release the vehicle)

- [ ] **DRV-06** · parallel-safe · function `drivers.deactivate-driver`
- **Who:** owner, admin 200; dispatcher, driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER, F-ASSIGN.
- **Success:**

  ```bash
  call owner POST /drivers/$D/deactivate
  json owner GET /driver-assignments | jq '.items | length'
  ```

  200, `status: "inactive"`; the open assignment is closed in the same transaction (the list prints `0`).
- **Errors and edges:** twice → 200 again (idempotent, section 9); `call owner POST /drivers/nope/deactivate` →
  404 `drivers.driver-not-found`; assigning the inactive driver: `call owner POST /driver-assignments "{\"driverId\":\"$D\",\"vehicleId\":\"$V\"}"` → 409 `drivers.driver-inactive`.
- **Side effects:** `sql "select \"unassignedAt\" is not null from driver_assignment where id='$A'"` → `t`.
- **Harness:** `--only matrix`: `matrix:POST /drivers/:id/deactivate | *`; `--only lifecycle`: `lifecycle:drivers/deactivate`,
  `drivers/deactivate-again`, `drivers/deactivate-unknown`, `assignments/deactivate-releases-vehicle`,
  `assignments/after-deactivate-open-list`; `--only validation`: `validation:POST /drivers/:id/deactivate | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### DRV-07 · `DELETE /drivers/{driverId}/vehicle` (release the driver's vehicle)

- [ ] **DRV-07** · parallel-safe · function `drivers.unassign-vehicle`
- **Who:** owner, admin, dispatcher 200; driver, member 403; ownerB 404 `drivers.no-open-assignment`; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER, F-ASSIGN.
- **Success:**

  ```bash
  call dispatcher DELETE /drivers/$D/vehicle
  ```

  200. The assignment: `id` = `$A`, `driverId` = `$D`, `vehicleId` = `$V`, `unassignedAt` set.
- **Errors and edges:** again → 404 `drivers.no-open-assignment`; unknown driver
  `call owner DELETE /drivers/nope/vehicle` → 404 `drivers.no-open-assignment` (it does not distinguish an
  unknown driver, section 9).
- **Side effects:** `sql "select \"unassignedAt\" is not null from driver_assignment where id='$A'"` → `t`;
  the vehicle can be assigned again (ASG-02).
- **Harness:** `--only matrix`: `matrix:DELETE /drivers/:id/vehicle | *`; `--only lifecycle`: `lifecycle:assignments/unassign`,
  `assignments/unassign-again`, `assignments/unassign-unknown-driver`, `assignments/reassign-freed-vehicle`;
  `--only validation`: `validation:DELETE /drivers/:id/vehicle | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### ASG-01 · `GET /driver-assignments` (current assignments, or history)

- [ ] **ASG-01** · parallel-safe · function `drivers.list-assignments`
- **Who:** all five roles 200; nocompany 403; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER, F-ASSIGN, then `code dispatcher DELETE /drivers/$D/vehicle`
  and assign again: `code owner POST /driver-assignments "{\"driverId\":\"$D\",\"vehicleId\":\"$V\"}"`.
- **Success:**

  ```bash
  call driver GET /driver-assignments
  call driver GET '/driver-assignments?includeClosed=true'
  ```

  200 `{"items":[…]}` without paging. The first holds one open assignment (`unassignedAt: null`); the
  second holds two, the closed one with `unassignedAt` set, newest `assignedAt` first.
- **Errors and edges:** `?includeClosed=yes`, `?includeClosed=TRUE`, `?includeClosed=` → 422 `validation`
  (only `true` and `false`).
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /driver-assignments | *`; `--only lifecycle`: `lifecycle:assignments/list-open`,
  `assignments/history`, `assignments/open-list-excludes-closed`; `--only validation`: `validation:GET /driver-assignments?*` (5 rows).
- **Result:**
  - Node:
  - Bun:

### ASG-02 · `POST /driver-assignments` (assign a vehicle to a driver)

- [ ] **ASG-02** · parallel-safe · function `drivers.assign-vehicle`
- **Who:** owner, admin, dispatcher 201; driver, member 403; ownerB 404 `drivers.driver-not-found`; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER, plus a second vehicle and driver:
  `V2=$(json owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"CK 2\",\"year\":2022}" | jq -r .id)`;
  `D2=$(json owner POST /drivers '{"fullName":"Second","phone":"+201001234567","licenseNumber":"CK-0002","licenseClass":"B","licenseExpiresOn":"2030-01-01"}' | jq -r .id)`.
- **Success:**

  ```bash
  call dispatcher POST /driver-assignments "{\"driverId\":\"$D\",\"vehicleId\":\"$V\"}"
  ```

  201. `id`, `driverId` = `$D`, `vehicleId` = `$V`, `assignedAt`, `unassignedAt: null`.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | driver already has a vehicle | `"driverId":"$D","vehicleId":"$V2"` | 409 `drivers.driver-already-assigned` |
  | vehicle already has a driver | `"driverId":"$D2","vehicleId":"$V"` | 409 `drivers.vehicle-already-assigned` |
  | vehicle in maintenance | `code owner PUT /vehicles/$V2/status '{"status":"maintenance"}'`, then `"driverId":"$D2","vehicleId":"$V2"` | 409 `drivers.vehicle-unavailable` |
  | unknown or other company's vehicle | `"vehicleId":"nope"` | 409 `drivers.vehicle-unavailable` ("does not exist or is not active") |
  | unknown driver | `"driverId":"nope"` | 404 `drivers.driver-not-found` |
  | inactive driver | `code owner POST /drivers/$D2/deactivate`, then assign `$D2` | 409 `drivers.driver-inactive` |
  | missing field | `'{"driverId":"x"}'` | 422 `validation` |
  | expired license | needs a database edit as in DRV-05 | 422 `drivers.license-expired` |
- **Side effects:** `sql "select count(*) from driver_assignment where \"vehicleId\"='$V' and \"unassignedAt\" is null"` → `1`.
- **Harness:** `--only matrix`: `matrix:POST /driver-assignments | *`; `--only lifecycle`: `lifecycle:assignments/create`,
  `assignments/driver-already-assigned`, `assignments/vehicle-already-assigned`, `assignments/driver-inactive`,
  `assignments/vehicle-in-maintenance`, `assignments/vehicle-unknown`, `assignments/driver-unknown`,
  `assignments/foreign-vehicle`; `--only validation`: `validation:POST /driver-assignments | *` (26 rows).
- **Result:**
  - Node:
  - Bun:

---

## 4 Documents

Private bucket `documents.files` (MinIO in Docker under `relkit dev`), PDF, JPEG or PNG up to 5,000,000
bytes. The signed URLs point at the MinIO port on `127.0.0.1`, not at the application.

| Route | Permission | owner | admin | dispatcher | driver | member |
|---|---|---|---|---|---|---|
| `GET /documents` | `document:read` | 200 | 200 | 200 | 200 | 200 |
| `POST /documents` | `document:create` | 201 | 201 | 403 | 403 | 403 |
| `POST /documents/{documentId}/confirm` | `document:create` | 200 | 200 | 403 | 403 | 403 |
| `GET /documents/{documentId}/download` | `document:read` | 200 | 200 | 200 | 200 | 200 |
| `DELETE /documents/{documentId}` | `document:delete` | 200 | 200 | 403 | 403 | 403 |

`ownerB` gets 404 (`documents.owner-not-found`, `documents.document-not-found`).

### DOC-FLOW · upload sequence: request-upload → PUT → confirm → download → delete

- [ ] **DOC-FLOW** · parallel-safe · covers DOC-01 to DOC-05 end to end
- **Who:** owner (each step's roles are in the table).
- **Prerequisites:** F-DRIVER.
- **Steps and expected answers:**

  ```bash
  printf '%%PDF-1.4 checklist sample\n' > "$S/sample.pdf"; SIZE=$(wc -c < "$S/sample.pdf" | tr -d ' ')   # 26
  # 1 request-upload
  json owner POST /documents "{\"ownerType\":\"driver\",\"ownerId\":\"$D\",\"kind\":\"license\",\"filename\":\"license scan.pdf\",\"contentType\":\"application/pdf\",\"sizeBytes\":$SIZE}" | tee "$S/upload.json" | jq .document
  DOC=$(jq -r .document.id "$S/upload.json"); URL=$(jq -r .uploadUrl "$S/upload.json")
  # 2 before the upload
  code owner GET /documents/$DOC/download                     # 409 documents.document-not-ready
  code owner POST /documents/$DOC/confirm                     # 409 documents.upload-missing
  json owner GET "/documents?ownerType=driver&ownerId=$D"     # {"items":[]}  (pending documents are not listed)
  # 3 PUT to the signed URL
  curl -sS -o /dev/null -w '%{http_code}\n' -X PUT "$URL" -H 'Content-Type: image/png' --data-binary @"$S/sample.pdf"        # 403 other type
  curl -sS -o /dev/null -w '%{http_code}\n' -X PUT "$URL" -H 'Content-Type: application/pdf' --data-binary @"$S/sample.pdf"  # 200
  # 4 confirm (twice)
  call owner POST /documents/$DOC/confirm                     # 200, status "uploaded"
  code owner POST /documents/$DOC/confirm                     # 200 again (idempotent)
  # 5 list and download
  json driver GET "/documents?ownerType=driver&ownerId=$D" | jq '.items[0] | {id,status}'
  json member GET /documents/$DOC/download | tee "$S/dl.json" | jq '{filename,contentType}'
  curl -sS "$(jq -r .url "$S/dl.json")"                       # %PDF-1.4 checklist sample
  # 6 delete
  code dispatcher DELETE /documents/$DOC                      # 403 access-denied
  call owner DELETE /documents/$DOC                           # 200 {"deleted":true}
  code owner GET /documents/$DOC/download                     # 404 documents.document-not-found
  curl -sS -o /dev/null -w '%{http_code}\n' "$(jq -r .url "$S/dl.json")"   # 404, the object is gone
  ```

  Step 1: 201 with `document` (`status: "pending"`, `sizeBytes: 26`, `contentType`, `filename`, `ownerType`,
  `ownerId`, `kind`, no `objectKey`, no `organizationId`) and `uploadUrl` (`http://127.0.0.1:<minio port>/…`,
  the key starts with `$COMPANY_A/driver/$D/`).
- **Side effects:** after step 4 `sql "select status, \"sizeBytes\" from document where id='$DOC'"` → `uploaded|26`;
  after step 6 → no row; the stored object answers 404 (last command).
- **Harness:** `--only lifecycle`: `lifecycle:documents/*` (33 rows, with the vehicle-owner variant
  `documents/vehicle-owner-*`); `--only matrix`: the five `matrix:… /documents… | *` routes.
- **Result:**
  - Node:
  - Bun:

### DOC-01 · `GET /documents` (list a driver's or vehicle's documents)

- [ ] **DOC-01** · parallel-safe · function `documents.list-documents`
- **Who:** all five roles 200; nocompany 403; anon 401.
- **Prerequisites:** F-DRIVER, F-DOC.
- **Success:** `call driver GET "/documents?ownerType=driver&ownerId=$D"` → 200 `{"items":[…]}` with `$DOC`,
  `status: "uploaded"`. Only uploaded documents are listed.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | missing parameters | `call owner GET /documents`; `?ownerType=driver`; `?ownerId=$D` | 422 `validation` |
  | unknown owner type | `?ownerType=company&ownerId=$D` | 422 `validation` |
  | empty owner id | `?ownerType=driver&ownerId=` | 422 `validation` |
  | unknown owner | `?ownerType=driver&ownerId=does-not-exist` | 200 `{"items":[]}` (no existence check) |
  | wrong owner type | `?ownerType=vehicle&ownerId=$D` | 200 `{"items":[]}` |
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /documents | *`; `--only lifecycle`: `lifecycle:documents/list`,
  `documents/list-excludes-pending`, `documents/vehicle-owner-list`; `--only validation`: `validation:GET /documents*` (7 rows).
- **Result:**
  - Node:
  - Bun:

### DOC-02 · `POST /documents` (request an upload)

- [ ] **DOC-02** · parallel-safe · function `documents.request-upload`
- **Who:** owner, admin 201; dispatcher, driver, member 403; ownerB 404 `documents.owner-not-found`; anon 401.
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER.
- **Success:** step 1 of DOC-FLOW → 201 `{document, uploadUrl}`. With `"ownerType":"vehicle","ownerId":"$V"` → 201 too.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | unknown owner | `call owner POST /documents '{"ownerType":"vehicle","ownerId":"nope","kind":"license","filename":"a.pdf","contentType":"application/pdf","sizeBytes":10}'` | 404 `documents.owner-not-found`, `data: {ownerType, ownerId}` |
  | another company's driver | as `ownerB` with `"ownerId":"$D"` | 404 `documents.owner-not-found` |
  | kind, type and size | `call owner POST /documents "{\"ownerType\":\"driver\",\"ownerId\":\"$D\",\"kind\":\"photo\",\"filename\":\"a.gif\",\"contentType\":\"image/gif\",\"sizeBytes\":5000001}"` | 422 `validation` on `kind`, `contentType`, `sizeBytes` |
  | size 0 | `"sizeBytes":0` | 422 `validation` |
  | filename | empty, over 200 characters, or with a NUL | 422 `validation` |
- **Side effects:** a `pending` row: `sql "select status from document where id='<id>'"` → `pending`; no object yet.
- **Harness:** `--only matrix`: `matrix:POST /documents | *`; `--only lifecycle`: `lifecycle:documents/request-upload`,
  `documents/owner-not-found`, `documents/owner-vehicle-not-found`, `documents/over-5mb-declared`;
  `--only validation`: `validation:POST /documents | *` (56 rows).
- **Result:**
  - Node:
  - Bun:

### DOC-03 · `POST /documents/{documentId}/confirm`

- [ ] **DOC-03** · parallel-safe · function `documents.confirm-upload`
- **Who:** owner, admin 200; dispatcher, driver, member 403; ownerB 404 `documents.document-not-found`; anon 401.
- **Prerequisites:** F-DRIVER, then steps 1 and 3 of DOC-FLOW (requested and uploaded, not confirmed).
- **Success:** `call owner POST /documents/$DOC/confirm` → 200, `status: "uploaded"`; again → 200.
- **Errors and edges:**

  | Case | Request | Expected |
  |---|---|---|
  | nothing uploaded | confirm right after step 1 | 409 `documents.upload-missing` |
  | unknown | `call owner POST /documents/nope/confirm` | 404 `documents.document-not-found` |
  | bytes of another size | request with `"sizeBytes":30`, PUT the 26-byte file to its URL (403 from the store), confirm | 409 `documents.upload-missing` (section 9: `documents.upload-size-mismatch` cannot be reached through a signed URL) |
  | file over 5 MB to a small declaration | request `sizeBytes: 26`, PUT 5,000,001 bytes | PUT 403; confirm 409 `documents.upload-missing` |
- **Side effects:** `sql "select status from document where id='$DOC'"` → `uploaded`.
- **Harness:** `--only matrix`: `matrix:POST /documents/:id/confirm | *`; `--only lifecycle`: `lifecycle:documents/confirm`,
  `documents/confirm-twice`, `documents/confirm-upload-missing`, `documents/confirm-unknown`,
  `documents/size-mismatch-*`, `documents/wrong-content-type-*`, `documents/over-5mb-*`;
  `--only validation`: `validation:POST /documents/:id/confirm | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### DOC-04 · `GET /documents/{documentId}/download` (signed download URL)

- [ ] **DOC-04** · parallel-safe · function `documents.get-download-url`
- **Who:** all five roles 200; ownerB 404; nocompany 403; anon 401.
- **Prerequisites:** F-DRIVER, F-DOC.
- **Success:** `json member GET /documents/$DOC/download` → 200 `{url, filename: "license scan.pdf", contentType: "application/pdf"}`;
  `curl -sS "<url>"` returns the uploaded bytes.
- **Errors and edges:** pending document → 409 `documents.document-not-ready`; unknown → 404
  `documents.document-not-found`; id with a NUL (`/documents/a%00b/download`) → 422 `validation`.
- **Side effects:** none.
- **Harness:** `--only matrix`: `matrix:GET /documents/:id/download | *`; `--only lifecycle`: `lifecycle:documents/download`,
  `documents/fetch-signed-download-url`, `documents/download-not-ready`, `documents/download-unknown`,
  `documents/download-after-delete`; `--only validation`: `validation:GET /documents/:id/download | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

### DOC-05 · `DELETE /documents/{documentId}`

- [ ] **DOC-05** · parallel-safe · function `documents.delete-document`
- **Who:** owner, admin 200; dispatcher, driver, member 403; ownerB 404; anon 401.
- **Prerequisites:** F-DRIVER, F-DOC; keep a download URL first: `json owner GET /documents/$DOC/download > "$S/dl.json"`.
- **Success:** `call owner DELETE /documents/$DOC` → 200 `{"deleted":true}`.
- **Errors and edges:** again → 404 `documents.document-not-found`; `call dispatcher DELETE /documents/$DOC` (before) → 403.
- **Side effects:** `sql "select count(*) from document where id='$DOC'"` → `0`;
  `curl -sS -o /dev/null -w '%{http_code}\n' "$(jq -r .url "$S/dl.json")"` → 404 (object removed).
- **Harness:** `--only matrix`: `matrix:DELETE /documents/:id | *`; `--only lifecycle`: `lifecycle:documents/delete`,
  `documents/delete-again`, `documents/delete-unknown`, `documents/signed-url-after-delete`;
  `--only validation`: `validation:DELETE /documents/:id | *` (8 rows).
- **Result:**
  - Node:
  - Bun:

---

## 5 Event reaction

Event `fleet.vehicle-status-changed` (version 1, local provider), published by VEH-05 and VEH-06 with
`{organizationId, vehicleId, from, to, at}`. Reaction `drivers.release-unavailable-vehicle`: when `to` is
not `active`, every open assignment of the vehicle is closed. It runs after the request answers, so poll.

### EVT-01 · maintenance releases the driver

- [ ] **EVT-01** · parallel-safe
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER, F-ASSIGN, and a bystander pair:
  `V2=$(json owner POST /vehicles "{\"modelId\":\"$M\",\"plate\":\"CK 2\",\"year\":2022}" | jq -r .id)`;
  `D2=$(json owner POST /drivers '{"fullName":"Second","phone":"+201001234567","licenseNumber":"CK-0002","licenseClass":"B","licenseExpiresOn":"2030-01-01"}' | jq -r .id)`;
  `code owner POST /driver-assignments "{\"driverId\":\"$D2\",\"vehicleId\":\"$V2\"}"`.
- **Trigger and check:**

  ```bash
  code dispatcher PUT /vehicles/$V/status '{"status":"maintenance"}'
  for i in $(seq 1 50); do json owner GET /driver-assignments | jq -e --arg v "$V" 'all(.items[]; .vehicleId != $v)' >/dev/null && break; sleep 0.2; done; echo "released after ~$((i*200)) ms"
  json owner GET /driver-assignments | jq '[.items[].vehicleId]'
  ```

  200; the assignment of `$V` disappears from the open list within 10 s (observed under 1 s); the
  bystander assignment of `$V2` stays open.
- **Side effects:** `sql "select \"unassignedAt\" is not null from driver_assignment where id='$A'"` → `t`;
  `json owner GET '/driver-assignments?includeClosed=true'` keeps it with `unassignedAt`. The server log has
  `released driver from unavailable vehicle` with `released: 1`.
- **Harness:** `--only effects`: `effects:reaction maintenance | trigger`, `| assignment closed`, `| history keeps closed assignment`.
- **Result:**
  - Node:
  - Bun:

### EVT-02 · retirement releases the driver

- [ ] **EVT-02** · parallel-safe
- **Prerequisites:** as EVT-01.
- **Trigger and check:** `code owner POST /vehicles/$V/retire`, then the poll of EVT-01. Same expectations.
- **Harness:** `--only effects`: `effects:reaction retire | trigger`, `| assignment closed`, `| history keeps closed assignment`.
- **Result:**
  - Node:
  - Bun:

### EVT-03 · no reaction without a status change

- [ ] **EVT-03** · parallel-safe
- **Prerequisites:** F-MODEL, F-VEHICLE, F-DRIVER, F-ASSIGN.
- **Trigger and check:** `code owner PATCH /vehicles/$V '{"year":2024}'`, wait 2 s, then
  `json owner GET /driver-assignments | jq '[.items[].vehicleId]'` still contains `$V`. Moving the vehicle
  back to `active` (after maintenance) opens nothing: the driver stays released.
- **Harness:** `--only effects`: `effects:reaction no-op | assigned vehicle patched (plate) keeps assignment`,
  `effects:reaction no-op | assignment still open after unrelated update`.
- **Result:**
  - Node:
  - Bun:

---

## 6 Realtime channel `fleet.vehicle-status`

Channel params `{companyId}`, event `changed` with `{vehicleId, from, to, at}`, triggered by VEH-05 and
VEH-06. Guard: a session whose active company is `companyId` and a `member` row in it; otherwise the call
is refused with `NOT_FOUND` (404). Replay: 300 s or 500 events, from a server-issued checkpoint.

The procedure is `relkit.realtime.subscribe` over RPC:

- **HTTP:** `POST /_relkit/v1/rpc/relkit.realtime.subscribe` answers an event stream (`text/event-stream`).
- **WebSocket:** `ws://127.0.0.1:4110/_relkit/v1/rpc`; the session cookie and `Origin` go on the upgrade.

Both need the headers `x-relkit-identity-scope` and `x-relkit-session-epoch` from
`GET /_relkit/v1/client/identity` sent with the same cookies; without them the call fails with
`IDENTITY_PRECONDITION_FAILED` (409). `scripts/checklist/realtime.mjs` does all of this with
`@relkit/client` (`createClient` for HTTP, `createWebSocketClient` for WebSocket) and prints one JSON line
per frame (`caught-up`, `event`, `gap`) or an `error`, then a `done` line. Run it with `node` or with `bun`.

Frame kinds: `caught-up` ends the replay (a subscription without a checkpoint sends no history, only
`caught-up`), `event` carries `event`, `payload` and its own `checkpoint`, `gap` means the checkpoint could not
be honoured and the client must reload state.

Prerequisites for every item in this section: setup, F-MODEL, F-VEHICLE.

### RT-01 · delivery over HTTP

- [ ] **RT-01** · parallel-safe
- **Who:** every member of company A (owner, admin, dispatcher, driver, member).
- **Request:**

  ```bash
  node scripts/checklist/realtime.mjs --state "$S" --actor member --company "$COMPANY_A" --transport http --events 1 --timeout 8000 > "$S/rt.out" &
  sleep 1.5; code dispatcher PUT /vehicles/$V/status '{"status":"maintenance"}'; wait; cat "$S/rt.out"
  ```

  Frames: `caught-up`, then `{"kind":"event","event":"changed","payload":{"vehicleId":"$V","from":"active","to":"maintenance","at":"…"},"checkpoint":{…}}`;
  the payload has exactly the keys `at`, `from`, `to`, `vehicleId`; last line `done` with `events: 1`,
  `timedOut: false`. Repeat with `--actor owner`, `driver`, `dispatcher` (move the vehicle back to `active`
  between runs with `code owner PUT /vehicles/$V/status '{"status":"active"}'`).
- **Wire check (raw HTTP):**

  ```bash
  ID=$(curl -sS -H "Origin: $BASE" -b "$S/dispatcher.jar" $BASE/_relkit/v1/client/identity)
  curl -sS -N --max-time 3 -X POST "$BASE/_relkit/v1/rpc/relkit.realtime.subscribe" -H "Origin: $BASE" -b "$S/dispatcher.jar" -H 'Content-Type: application/json' -H "x-relkit-identity-scope: $(echo "$ID" | jq -r .identityScope)" -H "x-relkit-session-epoch: $(echo "$ID" | jq -r .sessionEpoch)" --data "{\"json\":{\"channel\":\"fleet.vehicle-status\",\"params\":{\"companyId\":\"$COMPANY_A\"}}}" -D -
  ```

  `HTTP/1.1 200`, `Content-Type: text/event-stream`, `x-request-id`, then `event: message` with
  `data: {"json":{"kind":"caught-up",…}}`; curl ends with exit status 28 after 3 s (the stream stays open).
- **Harness:** `--only effects`: `effects:rt subscribe | dispatcher receives changed`, `| member …`, `| driver …`,
  `| owner …`, with `effects:rt trigger | <role> receives` and `effects:rt identity | <role> (receives change)`.
- **Result:**
  - Node:
  - Bun:

### RT-02 · delivery over WebSocket

- [ ] **RT-02** · parallel-safe
- **Request:** RT-01 with `--transport ws`. Same frames.
- **Upgrade `Origin` check:**

  ```bash
  node -e 'const {WebSocket}=require("ws");const u=process.argv[1].replace("http","ws")+"/_relkit/v1/rpc";for(const [l,h] of [["none",{}],["foreign",{origin:"https://evil.example"}],["same",{origin:process.argv[1]}]]){const w=new WebSocket(u,{headers:h});w.on("open",()=>{console.log(l,"open");w.close()});w.on("unexpected-response",(q,r)=>console.log(l,"refused",r.statusCode));w.on("error",()=>{})}' "$BASE"; sleep 2
  ```

  `none open`, `foreign refused 403`, `same open` (order may vary).
- **Harness:** not covered (the harness drives realtime over HTTP only). Record both results here.
- **Result:**
  - Node:
  - Bun:

### RT-03 · denial over HTTP

- [ ] **RT-03** · parallel-safe
- **Requests and expected:** each prints `{"error":{"code":"NOT_FOUND","status":404,"message":"Channel resource was not found."}}` and no `event` frame, unless noted.

  | Case | Command |
  |---|---|
  | owner of company B asks for A | `node scripts/checklist/realtime.mjs --state "$S" --actor ownerB --company "$COMPANY_A" --timeout 4000` |
  | signed-in user without a company | `… --actor nocompany --company "$COMPANY_A"` |
  | member of A asks for B | `… --actor member --company "$COMPANY_B"` |
  | unknown company id | `… --actor owner --company does-not-exist` |
  | anonymous visitor | `… --actor anon` |
  | unknown channel | `… --actor owner --channel fleet.nope` |
  | empty or wrong params | `… --actor owner --params '{"companyId":""}'`, `--params '{}'`, `--params '{"companyId":5}'` → `BAD_REQUEST` 400 "Channel params validation failed." |
  | stale identity headers | raw curl of RT-01 with `x-relkit-identity-scope: sha256:stale` → `IDENTITY_PRECONDITION_FAILED` 409 |

  Raw HTTP: a refused subscription answers `HTTP 200` with an `event: error` frame whose data is
  `{"json":{"defined":false,"code":"NOT_FOUND","status":404,…}}` (section 9).
- **Harness:** `--only effects`: `effects:rt deny | *` (9 rows), `effects:rt identity | stale identity headers`.
- **Result:**
  - Node:
  - Bun:

### RT-04 · denial over WebSocket

- [ ] **RT-04** · parallel-safe
- **Requests:** the table of RT-03 with `--transport ws`. Same answers.
- **Harness:** not covered.
- **Result:**
  - Node:
  - Bun:

### RT-05 · replay over HTTP

- [ ] **RT-05** · parallel-safe
- **Request:**

  ```bash
  node scripts/checklist/realtime.mjs --state "$S" --actor owner --transport http --events 0 --timeout 4000 | jq -c 'select(.kind=="caught-up").checkpoint' > "$S/cp.json"
  code owner PUT /vehicles/$V/status '{"status":"maintenance"}'; code owner PUT /vehicles/$V/status '{"status":"active"}'; code owner POST /vehicles/$V/retire
  node scripts/checklist/realtime.mjs --state "$S" --actor owner --transport http --after "$S/cp.json" --events 3 --timeout 6000 | jq -c '{kind,payload,seq:.checkpoint.sequence}'
  ```

  Three `event` frames for `$V` in order: `active>maintenance`, `maintenance>active`, `active>retired`, with
  increasing `checkpoint.sequence`.
- **Edges:**

  | Case | Command | Expected |
  |---|---|---|
  | no checkpoint | `… --actor owner --events 0` | only `caught-up` (no history) |
  | garbage checkpoint | `echo '{"x":1}' > "$S/bad.json"; … --after "$S/bad.json" --events 0` | `gap`, then `caught-up` |
  | A's checkpoint on B's channel | `… --actor ownerB --company "$COMPANY_B" --after "$S/cp.json" --events 0` | no company A event (`gap` or `caught-up`) |
  | B replays A's channel | `… --actor ownerB --company "$COMPANY_A" --after "$S/cp.json"` | `NOT_FOUND` before any replay |
  | abort ends the stream | every run's `done` line arrives within 1 s of the stop | `done` printed, process exits |
- **Harness:** `--only effects`: `effects:rt replay | *` (9 rows), `effects:rt abort probe * | *`.
- **Result:**
  - Node:
  - Bun:

### RT-06 · replay over WebSocket

- [ ] **RT-06** · parallel-safe
- **Request:** RT-05 with `--transport ws` in all three commands. Same answers.
- **Harness:** not covered.
- **Result:**
  - Node:
  - Bun:

---

## 7 System routes

No setup needed beyond 0.5 (no actors). All are parallel-safe.

### SYS-01 · `GET /healthz` and `HEAD /healthz`

- [ ] **SYS-01**
- **Request:** `curl -sS -D - $BASE/healthz` and `curl -sS -I $BASE/healthz`.
- **Expected:** 200 `{"status":"ready","live":true,"ready":true}`, `Content-Type: application/json;charset=utf-8`,
  `Cache-Control: no-store`, `x-request-id`. `HEAD`: 200, `content-length: 43`, no body.
- **Harness:** `--only system`: `system:GET /healthz`, `system:HEAD /healthz`.
- **Result:**
  - Node:
  - Bun:

### SYS-02 · `GET /_relkit/v1/health/live`

- [ ] **SYS-02**
- **Request:** `curl -sS $BASE/_relkit/v1/health/live | jq '{protocol,status,graphHash}'`
- **Expected:** 200, `protocol: "relkit.inspector"`, `status: "ok"`, `Cache-Control: no-store`. In development
  the body also carries `graphHash` and `activationFingerprint` (section 9).
- **Harness:** `--only system`: `system:GET /_relkit/v1/health/live`, `system:exposure | health/live body` (section 9).
- **Result:**
  - Node:
  - Bun:

### SYS-03 · `GET /_relkit/v1/health/ready`

- [ ] **SYS-03**
- **Request:** `curl -sS $BASE/_relkit/v1/health/ready | jq '{status,environmentReady,providerReady,databaseReady,authReady}'`
- **Expected:** 200, `status: "ready"`, and the four flags `true`.
- **Not covered:** a degraded answer (it would need the database or the bucket stopped under a running server).
- **Harness:** `--only system`: `system:GET /_relkit/v1/health/ready`.
- **Result:**
  - Node:
  - Bun:

### SYS-04 · `GET /_relkit/v1/openapi.json`

- [ ] **SYS-04**
- **Request:**

  ```bash
  curl -sS $BASE/_relkit/v1/openapi.json | jq -c '{openapi, paths:(.paths|length), appOps:[.paths|to_entries[]|select(.key|startswith("/api/auth")|not)|.value|to_entries[]|select(.value|type=="object" and has("responses"))]|length, authOps:[.paths|to_entries[]|select(.key|startswith("/api/auth"))|.value|to_entries[]|select(.value|type=="object" and has("responses"))]|length, schemes:(.components.securitySchemes|keys)}'
  ```

- **Expected:** 200 `application/json`, `{"openapi":"3.1.0","paths":69,"appOps":25,"authOps":54,"schemes":["session"]}`.
  Every application operation except `GET /hello` has `security: [{"session":[]}]` and declares 401, 403,
  422, 429 and 500, plus 413 when it takes a body, and its domain errors (404/409/422).
- **Harness:** `--only system`: `system:GET /_relkit/v1/openapi.json`, `system:openapi.json content-type`;
  the `contract` group compares the document with every observed answer (full run only).
- **Result:**
  - Node:
  - Bun:

### SYS-05 · `GET /_relkit/v1/api-reference`

- [ ] **SYS-05**
- **Request:** `curl -sS $BASE/_relkit/v1/api-reference | grep -o -E '<title>[^<]*</title>|[a-z/_0-9.]*openapi\.json' | sort -u`
- **Expected:** 200 `text/html`, `<title>RelKit API Reference</title>` and a reference to `./openapi.json`
  (the Scalar UI). Open it in a browser to see the 25 routes.
- **Harness:** `--only system`: `system:GET /_relkit/v1/api-reference`.
- **Result:**
  - Node:
  - Bun:

### SYS-06 · `GET /_relkit/v1/client-contract.json`

- [ ] **SYS-06**
- **Request:** `curl -sS $BASE/_relkit/v1/client-contract.json | jq -c '{protocol,version,routes:(.routes|length),channels:(.channels|if type=="array" then map(.id) else keys end),procedures:(.procedures|if type=="array" then length else keys end)}'`
- **Expected:** 200, `X-Content-Type-Options: nosniff`, `{"protocol":"relkit.client-contract","version":7,"routes":25,"channels":["fleet.vehicle-status"],"procedures":25}`.
  Related: `GET /_relkit/v1/client/routes` → 200 `{"protocol":"relkit.client-routes", routes: 25 entries}`;
  `GET /_relkit/v1/client/contract-events` → 200 `text/event-stream` with a first `ready` event.
- **Harness:** `--only system`: `system:GET /_relkit/v1/client-contract.json`, `system:GET /_relkit/v1/client/routes`,
  `system:GET /_relkit/v1/client/contract-events (SSE, first event)`.
- **Result:**
  - Node:
  - Bun:

### SYS-07 · `GET /_relkit/v1/client/identity`

- [ ] **SYS-07** · needs 0.6 for the signed-in case
- **Request:** `curl -sS -D - -H "Origin: $BASE" $BASE/_relkit/v1/client/identity` and, after setup,
  `curl -sS -H "Origin: $BASE" -b "$S/owner.jar" $BASE/_relkit/v1/client/identity`.
- **Expected:** 200, `Cache-Control: no-store, private`, body `{protocol: "relkit.client-identity", version: 1,
  applicationId: "relkit-logistics-14-nov", identityScope, sessionEpoch, publicFingerprint, issuedAt}`.
  Anonymous: `set-cookie: relkit_visitor=…` (HttpOnly) and `relkit_csrf=…`. The owner's `identityScope`
  differs from the anonymous one.
- **Harness:** `--only system`: `system:GET /_relkit/v1/client/identity (anon)`, `(owner)`.
- **Result:**
  - Node:
  - Bun:

### SYS-08 · `/_relkit/v1/rpc`

- [ ] **SYS-08**
- **Requests:**

  | Request | Expected |
  |---|---|
  | `curl -sS $BASE/_relkit/v1/rpc` | 404 `{"json":{"defined":false,"code":"NOT_FOUND","status":404,"message":"Not Found"}}` |
  | `curl -sS -X POST -H "Origin: $BASE" -H 'content-type: application/json' --data '{}' $BASE/_relkit/v1/rpc` | 404, same body |
  | same with `--data '{bad'` | 404, same body |
  | `curl -sS -X POST -H "Origin: $BASE" -H 'content-type: application/json' --data '{"json":{"channel":"fleet.vehicle-status","params":{"companyId":"x"}}}' $BASE/_relkit/v1/rpc/relkit.realtime.subscribe` (no identity headers) | 409 `IDENTITY_PRECONDITION_FAILED` |
  | a real subscription | RT-01 to RT-06 |

  Never a 5xx.
- **Harness:** `--only system`: `system:GET /_relkit/v1/rpc (no body)`, `system:POST /_relkit/v1/rpc (empty json)`,
  `system:POST /_relkit/v1/rpc (malformed)`, `system:POST /_relkit/v1/rpc relkit.realtime.subscribe unauthenticated`;
  `--only effects`: `effects:rt rpc | GET /_relkit/v1/rpc without session`.
- **Result:**
  - Node:
  - Bun:

### HELLO-01 · `GET /hello`

- [ ] **HELLO-01** · function `hello.greet`, public (no access rule, no `security` in OpenAPI)
- **Who:** everyone, including `anon`: 200.
- **Requests:** `call anon GET '/hello?name=Ada'` → 200 `{"message":"Hello, Ada!"}`; `call anon GET /hello` →
  200 `{"message":"Hello, world!"}`.
- **Errors and edges:** `?name=` → 422 `validation` (`issues[0].path: ["name"]`); `?name=a&name=b` → 422;
  `?unknown=1` → 200; `POST /hello` → 405 `method-not-allowed`; a 20 KB header → 431 (section 9).
- **Side effects:** the server log has `hello invoked` with the name.
- **Harness:** `--only matrix`: `matrix:GET /hello | *`; `--only http`: `http:GET /hello *`;
  `--only validation`: `validation:GET /hello?*` (8 rows).
- **Result:**
  - Node:
  - Bun:

---

## 8 Cross-cutting HTTP behaviour

### X-01 · framework answers (`http` group)

- [ ] **X-01** · run alone (one harness group)
- **Run:** `node scripts/audit/run.mjs --base-url $BASE --out /tmp/relkit-audit/X-01-node --env npm --project "$PWD" --only http`
  (on Bun: `bun scripts/audit/run.mjs … --env bun`).
- **Expected:** `http` 62 rows, 62 as expected, no 5xx. It covers 404 (`not-found`, also for a trailing
  slash and a case difference), 405 with `Allow` before 401, `HEAD` (same `Content-Length` as `GET`),
  `OPTIONS` 204, CORS (foreign preflight and foreign state-changing request 403 `origin-denied`, simple
  foreign `GET` 200), the Problem Details envelope for 401/403/404/405/409/413/422,
  NUL characters 422, a 20 KB header 431, `nosniff`, `Cache-Control: no-store` on authenticated JSON, no
  `Server` banner, and the session cookie's attributes.
- **Result:**
  - Node:
  - Bun:

### X-02 · full harness run and contract rows

- [ ] **X-02** · run alone
- **Run:** `node scripts/audit/run.mjs --base-url $BASE --out /tmp/relkit-audit/X-02-node --env npm --project "$PWD"`
  (Bun: `bun scripts/audit/run.mjs … --out /tmp/relkit-audit/X-02-bun --env bun`).
- **Expected:** `done total=1243 passed=1191 failed=52`, the per-group table of 0.9, no 5xx. To compare
  two runs row by row: `node scripts/audit/compare.mjs <a>/results.jsonl <b>/results.jsonl` (expect no
  `passFailDifferences`; Node against Bun shows the three `statusDifferencesWithSamePass` of section 9).
- **Result:**
  - Node:
  - Bun:

---

## 9 Known and by design (do not report)

These answers look wrong but are intended or belong to a third party. The 52 harness rows that are "not as
expected" in every full run are all here; a report about one of them is not a failure unless its answer
differs from what is written below. (In the raw Markdown, `\|` inside a table stands for `|`: the row id
`validation:POST /vehicles | malformed json` is written `validation:POST /vehicles \| malformed json`.)

| Rows | Harness ids | What you see | Why |
|---|---|---|---|
| 18 | `validation:<route> \| malformed json`, `\| truncated json` (9 body routes) | 422 `validation` with issue `malformed-json` where the harness expected 400 | By design (RelKit decision D6): every invalid input is 422 |
| 18 | `validation:<route> \| content-type text/plain`, `\| content-type form-urlencoded` | 422 `validation` naming the content type where the harness expected 415 | By design (D6) |
| 3 | `system:exposure \| GET /_relkit/v1/graph \| no session`, `\| owner session`, `system:exposure \| graph body content scan` | `GET /_relkit/v1/graph` answers 200 on the application port | By design (D8): it carries identity fields only (hashes for activation); the full graph is served to the Inspector through its bridge |
| 1 | `system:exposure \| health/live body` | `health/live` has `graphHash` and `activationFingerprint` | Kept in development for the development loop; removed in production |
| 1 | `auth:get-session-after-failed-set-active` | After a refused `set-active`, `activeOrganizationId` is `null` instead of unchanged | Better Auth's behaviour |
| 1 | `auth:get-session-before-set-active` | `accept-invitation` already makes the company active for the accepting session | Better Auth's behaviour; a later sign-in starts with no active company (README) |
| 4 | `contract:method-undeclared \| HEAD /hello`, `HEAD /vehicles`, `OPTIONS /hello`, `OPTIONS /vehicles` | `HEAD` and `OPTIONS` are served but not in `openapi.json` | Listed remainder |
| 1 | `contract:status-undeclared \| GET /hello -> 431` | 431 for oversized headers is not declared | Listed remainder |
| 1 | `contract:content-type \| POST /api/auth/organization/set-active -> 403` | Better Auth's 403 is `application/json`, not `application/problem+json` | Third party (Better Auth error shape) |
| 1 | `contract:uncalled-better-auth-operations` | Better Auth operations in the document that the harness never calls | Listed remainder |
| 1 | `contract:error-envelope-consistency` | Two error shapes: Problem Details and Better Auth's `{"message","code"}` | Better Auth keeps its own shape |
| 1 | `contract:x-request-id-on-every-response` | No `x-request-id` on the client contract's event stream and on the 431 answer | Listed remainder |
| 1 | `contract:request-id-header-equals-body-traceId` | `x-request-id` ≠ body `traceId` | Documented: `requestId` equals the header, `traceId` is the trace |

Other answers that are intended:

- **Node and Bun differ on three harness rows, all passing:** `auth:no-origin-no-cookie-sign-in` and
  `auth:no-origin-no-cookie-sign-up` (Node 403, Bun 200: Node's `fetch` sends `Sec-Fetch-Mode`, which makes
  Better Auth require an `Origin`), and `http:404 | double slash` (Node 404, Bun 401: Bun's `fetch`
  collapses a leading `//` before sending). With curl both servers answer the same.
- **No `Origin` from curl on an application route is served in development** (0.5). A foreign `Origin`
  is always refused.
- **Cross-company ids answer 404, not 403**, with the domain code (`fleet.vehicle-not-found`, …): one company
  never learns that another company's id exists.
- **Lenient query numbers:** `limit=1e2` is 100, `limit=0x10` is 16, `offset=` is the default; `%FF` in a
  query decodes to U+FFFD. Only JSON bodies are strict.
- **`GET /hello?name=%00` answers 200:** `/hello` stores nothing, so it has no NUL rule; every input that
  reaches the database refuses NUL with 422.
- **Unknown body fields are ignored** (`status` in `PATCH /vehicles/{id}` or `/drivers/{id}`); status has its
  own routes.
- **Idempotent answers:** `POST /drivers/{id}/deactivate` and `/activate` twice → 200; `POST /documents/{id}/confirm`
  twice → 200.
- **`DELETE /drivers/{id}/vehicle` for an unknown driver** → 404 `drivers.no-open-assignment` (not
  `driver-not-found`).
- **`POST /driver-assignments` with an unknown vehicle** → 409 `drivers.vehicle-unavailable` ("does not exist or
  is not active"), not 404.
- **`documents.upload-size-mismatch` (422) is declared but not reachable** through the API: the signed URL is
  bound to the declared type and size, so the store refuses other bytes with 403 and confirm answers 409
  `documents.upload-missing`.
- **A signed upload URL stays valid until it expires**, also after confirm or delete (how presigned URLs work).
- **`drivers.license-expired` on activate and assign** needs a license that expired after registration;
  reach it with the database edit of DRV-05.
- **A refused realtime subscription over raw HTTP is `HTTP 200` with an `event: error` frame**; the client
  turns it into `NOT_FOUND` with `status: 404`.
- **Better Auth answers** use `{"message","code"}` and Better Auth's own statuses (400 for a taken slug,
  `ROLE_NOT_FOUND` without a `code` field, 401 with an empty body for `organization/create` without a session).
- **Bun only:** two requests written in one TCP write (pipelining) close the connection without an answer;
  Bun accepts conflicting `Content-Length` values. Runtime behaviour, not changed.
- **Node only:** a refused WebSocket upgrade has its status and headers but an empty body.
- **`npm run build` fails by design** while the bucket is the Docker S3 (README, "Before deploying").

---

## 10 How to report a failure

One report per failing request, in the item's result line as `see report <ITEM-ID>-<runtime>-<n>` and in
full wherever the coordinator collects reports:

```text
Report:     DRV-05-bun-1
Item:       DRV-05
Runtime:    bun (bun run dev --port 4110), RelKit 0.9.1, commit <git rev-parse --short HEAD>
Request:    call admin POST /drivers/<id>/activate          (exact command, with ids)
Expected:   200, status "active"                            (quote the checklist line)
Actual:     409 {"code":"…", …}                             (status and body, trimmed)
Request id: request-…                                       (the x-request-id line printed by `call`)
Notes:      reproduces 3/3; server log lines around the request id; harness row, if any
```

Before filing, check section 9, repeat the request once in a fresh `$S`, and include the server log lines
that carry the request id (`grep <request id>` in the terminal that runs `relkit dev`).
