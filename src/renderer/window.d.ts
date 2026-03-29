/**
 * Augments the browser window type with the EnvSetup preload API contract.
 */

import type { EnvSetupApi } from '../main/core/contracts'

declare global {
  interface Window {
    envSetup: EnvSetupApi
  }
}

export {}
