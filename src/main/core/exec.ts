/**
 * 兼容 AbortSignal 的 execFile Promise 封装，并保留无 options 时的三参调用形态。
 */

import { execFile } from 'node:child_process'
import type { ExecFileException, ExecFileOptions } from 'node:child_process'

type ExecFileResult = {
  stdout: string
  stderr: string
}

export function execFileAsync(
  file: string,
  args: string[],
  options?: ExecFileOptions,
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    const normalizedOptions = options
      ? Object.fromEntries(
          Object.entries(options).filter(([, value]) => value !== undefined),
        )
      : undefined
    const callback = (
      error: ExecFileException | null,
      stdoutOrResult: string | ExecFileResult,
      stderrValue?: string,
    ) => {
      const stdout =
        typeof stdoutOrResult === 'object' && stdoutOrResult !== null
          ? stdoutOrResult.stdout
          : stdoutOrResult
      const stderr =
        typeof stdoutOrResult === 'object' && stdoutOrResult !== null
          ? stdoutOrResult.stderr
          : (stderrValue ?? '')

      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }

      resolve({ stdout, stderr })
    }

    if (normalizedOptions && Object.keys(normalizedOptions).length > 0) {
      execFile(file, args, normalizedOptions, callback)
      return
    }

    execFile(file, args, callback)
  })
}
