/**
 * 决定当前执行是否采用 dry-run。
 *
 * 优先级：
 * 1. `ENVSETUP_REAL_RUN=1` -> 真实执行（返回 false）
 * 2. `ENVSETUP_REAL_RUN=0` -> 模拟执行（返回 true）
 * 3. 其他情况默认始终走模拟执行
 */
export function resolveDryRun(_isPackaged: boolean): boolean {
  const override = process.env.ENVSETUP_REAL_RUN

  if (override === '1') {
    return false
  }

  if (override === '0') {
    return true
  }

  return true
}
