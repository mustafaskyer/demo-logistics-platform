import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { ac, roles } from "./permissions.js";

export const auth = betterAuth({
  // The server refuses to start without BETTER_AUTH_URL; the fallback only serves `relkit check`.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4100",
  emailAndPassword: { enabled: true },
  plugins: [
    // A logistics company is a Better Auth organization; its members carry the company role.
    organization({
      ac,
      roles,
      creatorRole: "owner",
      schema: {
        organization: {
          additionalFields: {
            legalName: { type: "string", input: true, required: false },
            taxId: { type: "string", input: true, required: false },
            phone: { type: "string", input: true, required: false },
            address: { type: "string", input: true, required: false },
            country: { type: "string", input: true, required: false },
          },
        },
      },
    }),
  ],
});
