import type { HckBiosStatus } from "./hck-bios";

/**
 * Production must not expose an API port when the control-plane BIOS failed.
 * Development still binds so operators can inspect diagnostics.
 */
export function assertBiosStartupAllowed(bios: HckBiosStatus, production: boolean): void {
  if (production && bios.status === "failed") {
    throw new Error("HCK-BIOS failed during production startup");
  }
}

/**
 * Bind only after the completed BIOS decision. The scheduler callback is invoked
 * by the binder only once the server is listening.
 */
export function bindAfterBios(
  bios: HckBiosStatus,
  production: boolean,
  bind: (onListening: () => void) => void,
  startScheduler: () => void,
): void {
  assertBiosStartupAllowed(bios, production);
  bind(startScheduler);
}