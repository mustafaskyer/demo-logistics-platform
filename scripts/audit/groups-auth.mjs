// Groups: "auth" (Better Auth flows incl. failures) and "actors" (the sessions every later group uses).
import { Actor, problemCode as problemCodeOf } from "./lib.mjs";
import { PASSWORD, ROLES } from "./fixtures.mjs";

const J = "application/json";

export async function authGroup(audit, ctx, fx) {
  const G = "auth";
  const u1 = new Actor("auth-user1");
  const u2 = new Actor("auth-user2");
  const email1 = audit.email("auth1");
  const email2 = audit.email("auth2");
  u1.email = email1;
  u2.email = email2;
  const s = (o) => audit.step({ group: G, ...o });

  const up1 = await s({ name: "sign-up", actor: u1, method: "POST", path: "/api/auth/sign-up/email", body: { name: "Auth One", email: email1, password: PASSWORD }, expect: 200,
    check: "200, body.user.email, body.token, Set-Cookie better-auth.session_token", verify: (r) => (r.body?.user?.email === email1 && r.body?.token && r.headers["set-cookie"]?.some((c) => c.startsWith("better-auth.session_token=")) ? true : "missing user/token/session cookie") });
  u1.userId = up1.body?.user?.id;
  await s({ name: "sign-up-duplicate-email", actor: new Actor("anon"), method: "POST", path: "/api/auth/sign-up/email", body: { name: "Dup", email: email1, password: PASSWORD }, expect: [422, 400], basis: "openapi",
    note: "openapi declares 422 for sign-up; Better Auth itself documents 422 USER_ALREADY_EXISTS", check: "rejected, no session cookie", verify: (r) => (r.headers["set-cookie"] ? "a Set-Cookie was issued for a rejected sign-up" : true) });
  await s({ name: "sign-up-weak-password", method: "POST", path: "/api/auth/sign-up/email", body: { name: "Weak", email: audit.email("weak"), password: "short" }, expect: 400, basis: "http-norm" });
  await s({ name: "sign-up-invalid-email", method: "POST", path: "/api/auth/sign-up/email", body: { name: "Bad", email: "not-an-email", password: PASSWORD }, expect: 400, basis: "http-norm" });
  await s({ name: "sign-up-missing-fields", method: "POST", path: "/api/auth/sign-up/email", body: {}, expect: 400, basis: "http-norm" });

  await s({ name: "get-session", actor: u1, method: "GET", path: "/api/auth/get-session", expect: 200, check: "session.userId = user.id, no active organization yet",
    verify: (r) => (r.body?.user?.id === u1.userId && !r.body?.session?.activeOrganizationId ? true : "unexpected session shape") });
  const out = await s({ name: "sign-out", actor: u1, method: "POST", path: "/api/auth/sign-out", expect: 200, check: "success true, session cookie cleared" });
  await s({ name: "get-session-after-sign-out", actor: u1, method: "GET", path: "/api/auth/get-session", expect: 200, basis: "app-contract",
    note: "Better Auth answers 200 with a null body when there is no session", check: "body null", verify: (r) => (r.body === null ? true : "body not null") });
  await s({ name: "sign-in-wrong-password", actor: u1, method: "POST", path: "/api/auth/sign-in/email", body: { email: email1, password: "wrong-password-123" }, expect: 401, basis: "http-norm", check: "no session cookie",
    verify: (r) => (r.headers["set-cookie"] ? "Set-Cookie on failed login" : true) });
  await s({ name: "sign-in-unknown-user", actor: u1, method: "POST", path: "/api/auth/sign-in/email", body: { email: audit.email("nobody"), password: PASSWORD }, expect: 401, basis: "http-norm" });
  await s({ name: "sign-in", actor: u1, method: "POST", path: "/api/auth/sign-in/email", body: { email: email1, password: PASSWORD }, expect: 200, check: "token + session cookie",
    verify: (r) => (r.body?.token && r.headers["set-cookie"] ? true : "missing token or cookie") });

  const org = await s({ name: "organization-create", actor: u1, method: "POST", path: "/api/auth/organization/create",
    body: { name: `Auth Co ${audit.runId}`, slug: audit.slug("auth"), legalName: "Auth Co LLC", taxId: "TX-1", phone: "+20100000000", address: "1 Nile", country: "EG" }, expect: 200,
    check: "echoes name, slug and the five extra fields; creator is owner", verify: (r) => (r.body?.legalName === "Auth Co LLC" && r.body?.taxId === "TX-1" && r.body?.country === "EG" && r.body?.phone === "+20100000000" && r.body?.address === "1 Nile" && r.body?.members?.[0]?.role === "owner" ? true : "extra fields or owner role missing") });
  const orgId = org.body?.id;
  const up2 = await s({ name: "sign-up-second-user", actor: u2, method: "POST", path: "/api/auth/sign-up/email", body: { name: "Auth Two", email: email2, password: PASSWORD }, expect: 200 });
  await s({ name: "organization-create-duplicate-slug", actor: u2, method: "POST", path: "/api/auth/organization/create", body: { name: "Copy", slug: audit.slug("auth") }, expect: [400, 409, 422], basis: "app-contract", note: "tests/integration/company-access: >= 400" });
  await s({ name: "organization-create-no-session", actor: new Actor("anon"), method: "POST", path: "/api/auth/organization/create", body: { name: "X", slug: audit.slug("anon") }, expect: 401, basis: "http-norm" });
  await s({ name: "organization-list", actor: u1, method: "GET", path: "/api/auth/organization/list", expect: 200, verify: (r) => (Array.isArray(r.body) && r.body.some((o) => o.id === orgId) ? true : "created org not listed") });
  await s({ name: "get-session-active-after-create", actor: u1, method: "GET", path: "/api/auth/get-session", expect: 200, check: "activeOrganizationId = created org (README: creator's company becomes active)",
    verify: (r) => (r.body?.session?.activeOrganizationId === orgId ? true : `activeOrganizationId=${r.body?.session?.activeOrganizationId}`) });
  await s({ name: "set-active", actor: u1, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: orgId }, expect: 200 });
  await s({ name: "set-active-unknown-org", actor: u1, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: "does-not-exist" }, expect: [400, 403, 404], basis: "http-norm" });
  await s({ name: "get-session-after-failed-set-active", actor: u1, method: "GET", path: "/api/auth/get-session", expect: 200, basis: "http-norm", check: "a rejected set-active leaves the active organization unchanged",
    verify: (r) => (r.body?.session?.activeOrganizationId === orgId ? true : `activeOrganizationId became ${r.body?.session?.activeOrganizationId} (Better Auth clears it when set-active fails)`) });
  await s({ name: "set-active-restore", actor: u1, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: orgId }, expect: 200 });
  await s({ name: "set-active-foreign-org", actor: u2, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: orgId }, expect: [400, 401, 403], basis: "http-norm", note: "u2 is not signed in yet (no session) or not a member" });

  // u2 is invited
  u2.userId = up2.body?.user?.id;
  const inv = await s({ name: "invite-member", actor: u1, method: "POST", path: "/api/auth/organization/invite-member", body: { email: email2, role: "dispatcher" }, expect: 200, check: "invitation id, role dispatcher, status pending",
    verify: (r) => (r.body?.id && r.body?.role === "dispatcher" && r.body?.status === "pending" ? true : "invitation shape") });
  await s({ name: "invite-member-duplicate", actor: u1, method: "POST", path: "/api/auth/organization/invite-member", body: { email: email2, role: "dispatcher" }, expect: [400, 409], basis: "http-norm" });
  await s({ name: "invite-member-invalid-role", actor: u1, method: "POST", path: "/api/auth/organization/invite-member", body: { email: audit.email("badrole"), role: "superuser" }, expect: 400, basis: "http-norm" });
  await s({ name: "invite-member-as-non-member", actor: new Actor("anon"), method: "POST", path: "/api/auth/organization/invite-member", body: { email: audit.email("x"), role: "member" }, expect: 401, basis: "http-norm" });
  const u3 = new Actor("auth-user3");
  await fx.signUp(G, "sign-up-third-user", u3, "auth3");
  await s({ name: "accept-invitation-wrong-user", actor: u3, method: "POST", path: "/api/auth/organization/accept-invitation", body: { invitationId: inv.body?.id ?? "x" }, expect: [400, 403], basis: "http-norm", note: "invitation belongs to another e-mail" });
  await s({ name: "accept-invitation", actor: u2, method: "POST", path: "/api/auth/organization/accept-invitation", body: { invitationId: inv.body?.id ?? "x" }, expect: 200, check: "member row with role dispatcher",
    verify: (r) => (r.body?.member?.role === "dispatcher" ? true : `member.role=${r.body?.member?.role}`) });
  await s({ name: "accept-invitation-again", actor: u2, method: "POST", path: "/api/auth/organization/accept-invitation", body: { invitationId: inv.body?.id ?? "x" }, expect: [400, 403, 404], basis: "http-norm" });
  await s({ name: "get-session-before-set-active", actor: u2, method: "GET", path: "/api/auth/get-session", expect: 200, check: "README: a fresh member has no active company until set-active",
    note: "Observed: accept-invitation already activates the company on the accepting session; the README sentence only holds for a fresh sign-in (next rows).",
    verify: (r) => (!r.body?.session?.activeOrganizationId ? true : `activeOrganizationId already ${r.body.session.activeOrganizationId}`) });
  await s({ name: "member-sign-out", actor: u2, method: "POST", path: "/api/auth/sign-out", expect: 200 });
  await s({ name: "member-sign-in-again", actor: u2, method: "POST", path: "/api/auth/sign-in/email", body: { email: email2, password: PASSWORD }, expect: 200 });
  await s({ name: "fresh-sign-in-has-no-active-company", actor: u2, method: "GET", path: "/api/auth/get-session", expect: 200, basis: "relkit-docs", check: "README: a fresh sign-in has no active company until the client calls set-active",
    verify: (r) => (!r.body?.session?.activeOrganizationId ? true : `activeOrganizationId=${r.body.session.activeOrganizationId} straight after sign-in`) });
  await s({ name: "fresh-sign-in-company-routes-403", actor: u2, method: "GET", path: "/vehicle-models", expect: 403, basis: "app-contract", check: "no active company -> access-denied", verify: problemCodeOf("access-denied") });
  await s({ name: "set-active-member", actor: u2, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: orgId }, expect: 200 });
  await s({ name: "member-vehicle-models-read", actor: u2, method: "GET", path: "/vehicle-models", expect: 200, note: "dispatcher can read vehicle models after set-active" });

  // Origin / CSRF handling
  await s({ name: "no-origin-with-session", actor: u1, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: orgId }, origin: false, expect: 403, basis: "http-norm",
    note: "state-changing request carrying the session cookie but no Origin header (CSRF)" });
  await s({ name: "foreign-origin-with-session", actor: u1, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: orgId }, headers: { origin: "https://evil.example" }, expect: 403, basis: "http-norm" });
  await s({ name: "no-origin-no-cookie-sign-in", actor: new Actor("anon"), method: "POST", path: "/api/auth/sign-in/email", body: { email: email1, password: PASSWORD }, origin: false, expect: [200, 403], basis: "relkit-docs",
    note: "client dependent: curl (no Sec-Fetch-* headers) gets 200, Node/undici fetch gets 403 MISSING_OR_NULL_ORIGIN. Both accepted; the observed status is in actual." });
  await s({ name: "no-origin-no-cookie-sign-up", actor: new Actor("anon"), method: "POST", path: "/api/auth/sign-up/email", body: { name: "NoOrigin", email: audit.email("noorigin"), password: PASSWORD }, origin: false, expect: [200, 403], basis: "relkit-docs", note: "see above" });

  // Malformed input
  await s({ name: "invalid-json", actor: new Actor("anon"), method: "POST", path: "/api/auth/sign-in/email", rawBody: "{bad", expect: 400, basis: "http-norm", check: "400 with an error body" });
  await s({ name: "empty-body", actor: new Actor("anon"), method: "POST", path: "/api/auth/sign-in/email", rawBody: "", expect: 400, basis: "http-norm" });
  await s({ name: "wrong-content-type", actor: new Actor("anon"), method: "POST", path: "/api/auth/sign-in/email", rawBody: JSON.stringify({ email: email1, password: PASSWORD }), headers: { "content-type": "text/plain" }, expect: [400, 415], basis: "http-norm" });
  await s({ name: "unknown-auth-path", actor: new Actor("anon"), method: "GET", path: "/api/auth/does-not-exist", expect: 404, basis: "http-norm" });
  await s({ name: "auth-ok", actor: new Actor("anon"), method: "GET", path: "/api/auth/ok", expect: 200, basis: "openapi" });
  await s({ name: "list-sessions", actor: u1, method: "GET", path: "/api/auth/list-sessions", expect: 200, basis: "openapi" });
  await s({ name: "get-full-organization", actor: u1, method: "GET", path: "/api/auth/organization/get-full-organization", expect: 200, basis: "openapi" });
  await s({ name: "list-members", actor: u1, method: "GET", path: "/api/auth/organization/list-members", expect: 200, basis: "openapi" });
  await s({ name: "get-active-member", actor: u1, method: "GET", path: "/api/auth/organization/get-active-member", expect: 200, basis: "openapi" });
  await s({ name: "check-slug-taken", actor: u1, method: "POST", path: "/api/auth/organization/check-slug", body: { slug: audit.slug("auth") }, expect: [400, 409], basis: "openapi", note: "slug is taken; Better Auth reports it as 400" });
  await s({ name: "check-slug-free", actor: u1, method: "POST", path: "/api/auth/organization/check-slug", body: { slug: audit.slug("free") }, expect: 200, basis: "openapi" });
  await s({ name: "list-invitations", actor: u1, method: "GET", path: "/api/auth/organization/list-invitations", expect: 200, basis: "openapi" });
  await s({ name: "has-permission", actor: u2, method: "POST", path: "/api/auth/organization/has-permission", body: { permissions: { vehicle: ["changeStatus"] } }, expect: 200, basis: "app-contract", check: "dispatcher has vehicle:changeStatus", verify: (r) => (r.body?.success === true ? true : "success !== true") });
  await s({ name: "has-permission-denied", actor: u2, method: "POST", path: "/api/auth/organization/has-permission", body: { permissions: { vehicle: ["delete"] } }, expect: 200, basis: "app-contract", check: "dispatcher lacks vehicle:delete", verify: (r) => (r.body?.success === false ? true : `success=${r.body?.success}`) });
  await s({ name: "update-organization-by-dispatcher", actor: u2, method: "POST", path: "/api/auth/organization/update", body: { data: { name: "Hijack" }, organizationId: orgId }, expect: 403, basis: "app-contract", note: "dispatcher has no organization:update" });
  await s({ name: "update-organization-by-owner", actor: u1, method: "POST", path: "/api/auth/organization/update", body: { data: { legalName: "Auth Co LLC (updated)" }, organizationId: orgId }, expect: 200, basis: "openapi" });
  await s({ name: "remove-member-by-dispatcher", actor: u2, method: "POST", path: "/api/auth/organization/remove-member", body: { memberIdOrEmail: email1, organizationId: orgId }, expect: [400, 403], basis: "app-contract", note: "Better Auth checks 'only owner' before the permission, so the owner target yields 400; 403 would be the permission denial" });
  await s({ name: "remove-member-by-owner", actor: u1, method: "POST", path: "/api/auth/organization/remove-member", body: { memberIdOrEmail: email2, organizationId: orgId }, expect: 200, basis: "openapi" });
  await s({ name: "removed-member-loses-access", actor: u2, method: "GET", path: "/vehicle-models", expect: [401, 403], basis: "app-contract", check: "a removed member's session still names the company but the member row is gone",
    note: "README: 'signed-in users without a role in the active company ... get 403'" });
  await s({ name: "change-password-wrong-current", actor: u1, method: "POST", path: "/api/auth/change-password", body: { currentPassword: "nope-nope-nope", newPassword: "another-long-password" }, expect: 400, basis: "openapi" });
  await s({ name: "update-user-name", actor: u1, method: "POST", path: "/api/auth/update-user", body: { name: "Auth One Renamed" }, expect: 200, basis: "openapi" });
  await s({ name: "revoke-other-sessions", actor: u1, method: "POST", path: "/api/auth/revoke-other-sessions", body: {}, expect: 200, basis: "openapi" });
  await s({ name: "delete-organization-by-owner", actor: u1, method: "POST", path: "/api/auth/organization/delete", body: { organizationId: orgId }, expect: 200, basis: "openapi" });
  await s({ name: "access-after-company-deleted", actor: u1, method: "GET", path: "/vehicle-models", expect: [401, 403], basis: "app-contract", note: "session still carries the deleted company as active organization" });
}

export async function actorsGroup(audit, ctx, fx) {
  const G = "actors";
  const s = (o) => audit.step({ group: G, ...o });
  ctx.owner = new Actor("owner");
  ctx.admin = new Actor("admin");
  ctx.dispatcher = new Actor("dispatcher");
  ctx.driver = new Actor("driver");
  ctx.member = new Actor("member");
  ctx.ownerB = new Actor("ownerB");
  ctx.nocompany = new Actor("nocompany");
  ctx.anon = new Actor("anon");

  await fx.signUp(G, "sign-up-owner", ctx.owner, "owner");
  const orgA = await s({ name: "company-A-create", actor: ctx.owner, method: "POST", path: "/api/auth/organization/create",
    body: { name: `Audit Co A ${audit.runId}`, slug: audit.slug("a"), legalName: "Audit A LLC", taxId: "A-1", country: "EG" }, expect: 200 });
  ctx.orgA = orgA.body?.id;
  await s({ name: "owner-session-active-company", actor: ctx.owner, method: "GET", path: "/api/auth/get-session", expect: 200, verify: (r) => (r.body?.session?.activeOrganizationId === ctx.orgA ? true : "active org is not company A") });

  for (const role of ["admin", "dispatcher", "driver", "member"]) {
    const a = ctx[role];
    await fx.signUp(G, `sign-up-${role}`, a, role);
    const inv = await s({ name: `invite-${role}`, actor: ctx.owner, method: "POST", path: "/api/auth/organization/invite-member", body: { email: a.email, role }, expect: 200, verify: (r) => (r.body?.id && r.body?.role === role ? true : "invitation shape") });
    await s({ name: `accept-${role}`, actor: a, method: "POST", path: "/api/auth/organization/accept-invitation", body: { invitationId: inv.body?.id ?? "missing" }, expect: 200 });
    const list = await s({ name: `list-organizations-${role}`, actor: a, method: "GET", path: "/api/auth/organization/list", expect: 200, verify: (r) => (Array.isArray(r.body) && r.body.length === 1 && r.body[0].id === ctx.orgA ? true : "expected exactly company A") });
    await s({ name: `set-active-${role}`, actor: a, method: "POST", path: "/api/auth/organization/set-active", body: { organizationId: list.body?.[0]?.id ?? ctx.orgA }, expect: 200 });
    await s({ name: `role-check-${role}`, actor: a, method: "GET", path: "/api/auth/organization/get-active-member", expect: 200, check: `member.role = ${role}`, verify: (r) => (r.body?.role === role ? true : `role=${r.body?.role}`) });
  }

  await fx.signUp(G, "sign-up-ownerB", ctx.ownerB, "ownerB");
  const orgB = await s({ name: "company-B-create", actor: ctx.ownerB, method: "POST", path: "/api/auth/organization/create", body: { name: `Audit Co B ${audit.runId}`, slug: audit.slug("b") }, expect: 200 });
  ctx.orgB = orgB.body?.id;
  await fx.signUp(G, "sign-up-nocompany", ctx.nocompany, "nocompany");
  await s({ name: "nocompany-session-has-no-active-company", actor: ctx.nocompany, method: "GET", path: "/api/auth/get-session", expect: 200, verify: (r) => (!r.body?.session?.activeOrganizationId ? true : "unexpected active org") });
  await s({ name: "anon-has-no-session", actor: ctx.anon, method: "GET", path: "/api/auth/get-session", expect: 200, verify: (r) => (r.body === null ? true : "expected null") });
  ctx.byRole = { owner: ctx.owner, admin: ctx.admin, dispatcher: ctx.dispatcher, driver: ctx.driver, member: ctx.member };
}
