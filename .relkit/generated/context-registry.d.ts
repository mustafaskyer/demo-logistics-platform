type RelkitApplicationEnv = import("relkit/config").ResolvedEnv<typeof import("../../relkit.config.js")["default"]["env"]["shape"]>;

declare global {
  namespace Relkit {
    interface ApplicationEnv extends RelkitApplicationEnv {}
    interface ApplicationContextRegistry {
    }
    interface TaskRegistry {
    }
    interface JobRegistry {
    }
    interface HandleServices {
    readonly "hello": typeof import("../../src/services/hello/service.js")["default"];
    }
    interface HandleDatabases {
    }
    interface HandleCaches {
    }
    interface HandleBuckets {
    }
    interface HandleChannels {
    }
    interface HandleAgents {
    }
  }
}

export {};
