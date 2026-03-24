import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Sensitive key names — matched case-insensitively
const SENSITIVE_KEYS_SOURCE =
  '(?:token|password|passwd|secret|api[_-]?key|auth|credential|private[_-]?key|access[_-]?key)'

// key=value (plain, no quotes)
const KV_PATTERN = new RegExp(`(${SENSITIVE_KEYS_SOURCE})\\s*=\\s*([^\\s,;&"'\`]+)`, 'gi')
// key: "value" or key: 'value' or key: `value` (JSON / YAML style)
const KV_QUOTED_PATTERN = new RegExp(
  `(${SENSITIVE_KEYS_SOURCE})\\s*[=:]\\s*(["'\`])([^"'\`]*)\\2`,
  'gi',
)
// Bearer <token> / Basic <token>
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/gi

export function sanitizeLog(line: string): string {
  return line
    .replace(KV_QUOTED_PATTERN, (_m, key, quote, _val) => `${key}=${quote}[REDACTED]${quote}`)
    .replace(KV_PATTERN, (_m, key) => `${key}=[REDACTED]`)
    .replace(BEARER_PATTERN, (m) => `${m.split(/\s+/)[0]} [REDACTED]`)
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
