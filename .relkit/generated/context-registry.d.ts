type RelkitApplicationEnv = import("relkit/config").ResolvedEnv<typeof import("../../relkit.config.js")["default"]["env"]["shape"]>;

declare global {
  namespace Relkit {
    interface ApplicationEnv extends RelkitApplicationEnv {}
    interface ApplicationContextRegistry {
    readonly database: import("@relkit/drizzle").DatabaseContext<typeof import("../../src/services/database/service.js")["default"]>;
    readonly auth: import("relkit/functions").AuthContext<import("@relkit/better-auth").InferBetterAuthSession<typeof import("../../src/services/auth/service.js")["default"]["handler"]>>;
    }
    interface TaskRegistry {
    }
    interface JobRegistry {
    }
    interface HandleServices {
    readonly "auth": typeof import("../../src/services/auth/service.js")["default"];
    readonly "database": typeof import("../../src/services/database/service.js")["default"];
    readonly "documents": typeof import("../../src/services/documents/service.js")["default"];
    readonly "drivers": typeof import("../../src/services/drivers/service.js")["default"];
    readonly "fleet": typeof import("../../src/services/fleet/service.js")["default"];
    readonly "hello": typeof import("../../src/services/hello/service.js")["default"];
    }
    interface HandleDatabases {
    readonly "database": typeof import("../../src/services/database/service.js")["default"];
    }
    interface HandleCaches {
    }
    interface HandleBuckets {
    readonly "documents.files": typeof import("../../src/services/documents/buckets/files.bucket.js")["default"];
    }
    interface HandleChannels {
    readonly "fleet.vehicle-status": typeof import("../../src/services/fleet/channels/vehicle-status.channel.js")["default"];
    }
    interface HandleAgents {
    }
  }
}

export {};
