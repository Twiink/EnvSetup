/**
 * 生成并清洗安装、清理与回滚流程中的结构化日志。
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// 敏感 key 名集合，匹配时忽略大小写。
const SENSITIVE_KEYS_SOURCE =
  '(?:token|password|passwd|secret|api[_-]?key|auth|credential|private[_-]?key|access[_-]?key)'

// 纯文本的 key=value 形式。
const KV_PATTERN = new RegExp(`(${SENSITIVE_KEYS_SOURCE})\\s*=\\s*([^\\s,;&"'\`]+)`, 'gi')
// JSON / YAML 风格的 key: "value"、key: 'value'、key: `value`。
const KV_QUOTED_PATTERN = new RegExp(
  `(${SENSITIVE_KEYS_SOURCE})\\s*[=:]\\s*(["'\`])([^"'\`]*)\\2`,
  'gi',
)
// 常见的 Authorization 头格式。
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
