/** Company roles and `resource:action` permissions enforced by RelKit function access rules. */
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/** Business resources and their actions, merged with Better Auth's organization/member/invitation set. */
export const statement = {
  ...defaultStatements,
  vehicleModel: ["create", "read", "update", "delete"],
  vehicle: ["create", "read", "update", "delete", "changeStatus"],
  driver: ["create", "read", "update", "delete"],
  assignment: ["create", "read", "delete"],
  document: ["create", "read", "delete"],
} as const;

export const ac = createAccessControl(statement);

/** Full control of the company, including billing-level organization actions. */
export const owner = ac.newRole({
  ...ownerAc.statements,
  vehicleModel: ["create", "read", "update", "delete"],
  vehicle: ["create", "read", "update", "delete", "changeStatus"],
  driver: ["create", "read", "update", "delete"],
  assignment: ["create", "read", "delete"],
  document: ["create", "read", "delete"],
});

/** Manages the fleet, drivers and members; cannot delete the company. */
export const admin = ac.newRole({
  ...adminAc.statements,
  vehicleModel: ["create", "read", "update", "delete"],
  vehicle: ["create", "read", "update", "delete", "changeStatus"],
  driver: ["create", "read", "update", "delete"],
  assignment: ["create", "read", "delete"],
  document: ["create", "read", "delete"],
});

/** Day-to-day operations: reads the fleet, changes vehicle status and assigns drivers. */
export const dispatcher = ac.newRole({
  ...memberAc.statements,
  vehicleModel: ["read"],
  vehicle: ["read", "update", "changeStatus"],
  driver: ["read"],
  assignment: ["create", "read", "delete"],
  document: ["read"],
});

/** A driver sees the fleet and driver roster but cannot change them. */
export const driver = ac.newRole({
  ...memberAc.statements,
  vehicleModel: ["read"],
  vehicle: ["read"],
  driver: ["read"],
  assignment: ["read"],
  document: ["read"],
});

/** Read-only staff. */
export const member = ac.newRole({
  ...memberAc.statements,
  vehicleModel: ["read"],
  vehicle: ["read"],
  driver: ["read"],
  assignment: ["read"],
  document: ["read"],
});

export const roles = { owner, admin, dispatcher, driver, member };
