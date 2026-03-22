import type { EnvSetupApi } from '../main/core/contracts'

declare global {
  interface Window {
    envSetup: EnvSetupApi
  }
}

export {}
