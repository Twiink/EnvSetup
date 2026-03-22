import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const REDACTION_PATTERNS = [/token=([^\s]+)/gi, /password=([^\s]+)/gi, /api[_-]?key=([^\s]+)/gi]

export function sanitizeLog(line: string): string {
  return REDACTION_PATTERNS.reduce(
    (sanitized, pattern) =>
      sanitized.replace(pattern, (match) => `${match.split('=')[0]}=[REDACTED]`),
    line,
  )
}

export async function appendTaskLog(
  taskId: string,
  lines: string[],
  tasksDir: string,
): Promise<void> {
  if (lines.length === 0) {
    return
  }

  await mkdir(tasksDir, { recursive: true })
  const content = `${lines.map((line) => sanitizeLog(line)).join('\n')}\n`
  await appendFile(join(tasksDir, `${taskId}.log`), content, 'utf8')
}
