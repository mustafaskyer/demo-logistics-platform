declare global {
  namespace Relkit {
    interface EventRegistry {
    readonly "fleet.vehicle-status-changed": typeof import("../../src/services/fleet/events/vehicle-status-changed.event.js")["default"];
    }
  }
}

export {};
