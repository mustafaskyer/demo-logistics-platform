/** Live vehicle status for one company. Browsers subscribe with their company id; the guard re-checks membership. */
import { getRelkit } from "relkit";
import { defineChannel } from "relkit/realtime";
import { z } from "zod";

interface GuardContext {
  readonly auth?: {
    readonly getSession: () => Promise<{
      readonly session: { readonly activeOrganizationId?: string | null | undefined };
      readonly user: { readonly id: string };
    } | null>;
  };
}

const vehicleStatus = defineChannel({
  id: "fleet.vehicle-status",
  params: z.object({ companyId: z.string().min(1) }),
  events: {
    changed: z.object({
      vehicleId: z.string(),
      from: z.enum(["active", "maintenance", "retired"]),
      to: z.enum(["active", "maintenance", "retired"]),
      at: z.string(),
    }),
  },
  client: {
    authorize: async ({ companyId }, context) => {
      const session = await (context as GuardContext).auth?.getSession();
      if (session === undefined || session === null) return false;
      if (session.session.activeOrganizationId !== companyId) return false;
      // The session alone can outlive a removed membership, so confirm the member row too.
      const member = await getRelkit().database.member.findOne({
        where: { organizationId: companyId, userId: session.user.id },
      });
      return member !== null;
    },
  },
  replay: { retentionMs: 300_000, maxEvents: 500 },
});

export default vehicleStatus;
