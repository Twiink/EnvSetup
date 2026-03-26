/**
 * Resolve whether the current execution should be a dry-run.
 *
 * Priority:
 * 1. `ENVSETUP_REAL_RUN=1` → real-run (returns false)
 * 2. `ENVSETUP_REAL_RUN=0` → dry-run  (returns true)
 * 3. Otherwise: always dry-run
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
