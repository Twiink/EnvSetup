/**
 * 为浏览器全局 window 扩展 EnvSetup preload API 类型。
 */

import type { EnvSetupApi } from '../main/core/contracts'

declare global {
  interface Window {
    envSetup: EnvSetupApi
  }
}

export {}
