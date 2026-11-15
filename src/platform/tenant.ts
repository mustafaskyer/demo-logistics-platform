/** Resolves the caller's company (Better Auth active organization) from the session. */
interface TenantSession {
  readonly session: { readonly activeOrganizationId?: string | null | undefined };
  readonly user: { readonly id: string };
}

export interface Tenant {
  readonly organizationId: string;
  readonly userId: string;
}

/**
 * Returns the caller's company and user id. Function access rules already require an active
 * company role, so a missing company here means the rule was omitted: fail closed.
 * @param auth - The function context's auth accessor.
 * @returns The tenant every query must be scoped to.
 */
export async function currentTenant(auth: {
  readonly getSession: () => Promise<TenantSession | null>;
}): Promise<Tenant> {
  const current = await auth.getSession();
  const organizationId = current?.session.activeOrganizationId;
  if (current === null || organizationId === undefined || organizationId === null || organizationId === "") {
    throw new Error("Tenant-scoped function was invoked without an active company");
  }
  return { organizationId, userId: current.user.id };
}

/**
 * Drops `undefined` entries so partial updates satisfy exact optional property types.
 * @param value - Candidate patch.
 * @returns The same entries without undefined values.
 */
export function definedOnly<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/**
 * Names the violated Postgres unique/foreign-key constraint, if the failure is one.
 * @param error - Native failure thrown by the database client.
 * @returns Constraint kind and name, or null for any other failure.
 */
export function constraintViolation(error: unknown): { kind: "unique" | "foreign-key"; name: string } | null {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const e = current as { code?: unknown; errno?: unknown; constraint?: unknown; constraintName?: unknown; cause?: unknown };
    // node-postgres puts the SQLSTATE in `code`; Bun's client puts it in `errno` beside a generic `code`.
    const code = [e.code, e.errno].map((value) => String(value ?? "")).find((value) => value === "23505" || value === "23503");
    if (code !== undefined) {
      const name = String(e.constraint ?? e.constraintName ?? "");
      return { kind: code === "23505" ? "unique" : "foreign-key", name };
    }
    current = e.cause;
  }
  return null;
}
