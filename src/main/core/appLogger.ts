/**
 * 集中式应用日志服务。
 *
 * - 分 info.log（info + warn）和 error.log 两个文件
 * - 所有写入经 sanitizeLog 脱敏
 * - 单文件超过 5 MB 时自动轮转，最多保留 5 个历史文件
 * - 提供 collectSystemInfo() 和 buildExportContent() 用于导出诊断日志
 */

import { appendFile, readdir, readFile, rename, stat } from 'node:fs/promises'
import { cpus, freemem, release, totalmem, version as osVersion } from 'node:os'
import { join } from 'node:path'

import type { LogEntry, LogExportFormat, LogLevel, SystemInfo } from './contracts'
import { sanitizeLog } from './logger'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_HISTORY_FILES = 5

let logsDir: string | undefined

export function initAppLogger(dir: string): void {
  logsDir = dir
}

function ensureInitialized(): string {
  if (!logsDir) {
    throw new Error('appLogger not initialized — call initAppLogger() first')
  }
  return logsDir
}

// ── 格式化 ──────────────────────────────────────────────

function formatTimestamp(): string {
  return new Date().toISOString()
}

function levelTag(level: LogLevel): string {
  return level.toUpperCase()
}

function formatLogLine(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    `[${levelTag(entry.level)}]`,
    `[${entry.source}]`,
    entry.message,
  ]

  const extra: Record<string, unknown> = {}
  if (entry.context) Object.assign(extra, { context: entry.context })
  if (entry.error) Object.assign(extra, { error: entry.error })

  if (Object.keys(extra).length > 0) {
    parts.push(JSON.stringify(extra))
  }

  return sanitizeLog(parts.join(' '))
}

// ── 轮转 ─────────────────────────────────────────────────

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath)
    if (info.size < MAX_FILE_SIZE) return
  } catch {
    return // 文件不存在，无需轮转
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const rotatedName = filePath.replace(/\.log$/, `.${ts}.log`)
  await rename(filePath, rotatedName)

  // 清理超出保留数量的历史文件
  const dir = ensureInitialized()
  const baseName = filePath.endsWith('error.log') ? 'error' : 'info'
  const pattern = new RegExp(`^${baseName}\\.\\d{4}-.*\\.log$`)
  const files = (await readdir(dir)).filter((f) => pattern.test(f)).sort()

  if (files.length > MAX_HISTORY_FILES) {
    const { unlink } = await import('node:fs/promises')
    const toRemove = files.slice(0, files.length - MAX_HISTORY_FILES)
    await Promise.all(toRemove.map((f) => unlink(join(dir, f))))
  }
}

// ── 写入 ─────────────────────────────────────────────────

async function writeToFile(fileName: string, line: string): Promise<void> {
  const dir = ensureInitialized()
  const filePath = join(dir, fileName)
  await rotateIfNeeded(filePath)
  await appendFile(filePath, line + '\n', 'utf8')
}

function buildEntry(
  level: LogLevel,
  source: string,
  message: string,
  options?: {
    error?: unknown
    context?: Record<string, unknown>
  },
): LogEntry {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    source,
    message,
  }

  if (options?.context) entry.context = options.context
  if (options?.error) {
    const err = options.error
    if (err instanceof Error) {
      entry.error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: (err as Error & { code?: string }).code,
      }
    } else {
      entry.error = { name: 'UnknownError', message: String(err) }
    }
  }

  return entry
}

export function logInfo(
  source: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!logsDir) return
  const entry = buildEntry('info', source, message, { context })
  writeToFile('info.log', formatLogLine(entry)).catch(() => {})
}

export function logWarn(
  source: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!logsDir) return
  const entry = buildEntry('warn', source, message, { context })
  writeToFile('info.log', formatLogLine(entry)).catch(() => {})
}

export function logError(
  source: string,
  message: string,
  options?: { error?: unknown; context?: Record<string, unknown> },
): void {
  if (!logsDir) return
  const entry = buildEntry('error', source, message, options)
  const line = formatLogLine(entry)
  // error 同时写入 info.log 和 error.log
  writeToFile('info.log', line).catch(() => {})
  writeToFile('error.log', line).catch(() => {})
}

// ── 渲染进程日志上报 ────────────────────────────────────

export function writeLog(entry: {
  level: LogLevel
  source: string
  message: string
  context?: Record<string, unknown>
}): void {
  switch (entry.level) {
    case 'error':
      logError(entry.source, entry.message, { context: entry.context })
      break
    case 'warn':
      logWarn(entry.source, entry.message, entry.context)
      break
    default:
      logInfo(entry.source, entry.message, entry.context)
  }
}

// ── 系统信息 ─────────────────────────────────────────────

export function collectSystemInfo(): SystemInfo {
  let electronVersion = ''
  let chromeVersion = ''
  let appVersionStr = ''
  let localeStr = ''
  let userDataStr = ''

  try {
    electronVersion = process.versions.electron ?? ''
    chromeVersion = process.versions.chrome ?? ''
  } catch {
    // 非 Electron 环境（测试）
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')
    appVersionStr = app.getVersion()
    localeStr = app.getLocale()
    userDataStr = app.getPath('userData')
  } catch {
    // 非 Electron 环境（测试）
  }

  const cpuInfo = cpus()
  return {
    platform: process.platform,
    arch: process.arch,
    osVersion: osVersion(),
    osRelease: release(),
    cpuModel: cpuInfo[0]?.model ?? 'unknown',
    cpuCores: cpuInfo.length,
    totalMemory: totalmem(),
    freeMemory: freemem(),
    electronVersion,
    nodeVersion: process.versions.node,
    chromeVersion,
    appVersion: appVersionStr,
    locale: localeStr,
    userData: userDataStr,
  }
}

// ── 导出 ─────────────────────────────────────────────────

async function readLogFile(fileName: string): Promise<string[]> {
  const dir = ensureInitialized()
  try {
    const content = await readFile(join(dir, fileName), 'utf8')
    return content.split('\n').filter((l) => l.length > 0)
  } catch {
    return []
  }
}

function parseLogLevel(line: string): LogLevel {
  if (line.includes('[ERROR]')) return 'error'
  if (line.includes('[WARN]')) return 'warn'
  return 'info'
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(2)} GB`
}

function buildTextExport(sysInfo: SystemInfo, infoLines: string[], errorLines: string[]): string {
  const sections: string[] = []

  sections.push('========================================')
  sections.push('EnvSetup 诊断日志导出')
  sections.push(`导出时间: ${new Date().toISOString()}`)
  sections.push('========================================')
  sections.push('')

  sections.push('--- 系统信息 ---')
  sections.push(`平台: ${sysInfo.platform} (${sysInfo.arch})`)
  sections.push(`系统版本: ${sysInfo.osVersion}`)
  sections.push(`系统发行: ${sysInfo.osRelease}`)
  sections.push(`CPU: ${sysInfo.cpuModel} (${sysInfo.cpuCores} cores)`)
  sections.push(
    `内存: ${formatBytes(sysInfo.totalMemory)} (可用 ${formatBytes(sysInfo.freeMemory)})`,
  )
  if (sysInfo.electronVersion) sections.push(`Electron: ${sysInfo.electronVersion}`)
  sections.push(`Node: ${sysInfo.nodeVersion}`)
  if (sysInfo.chromeVersion) sections.push(`Chrome: ${sysInfo.chromeVersion}`)
  if (sysInfo.appVersion) sections.push(`应用版本: ${sysInfo.appVersion}`)
  if (sysInfo.locale) sections.push(`语言: ${sysInfo.locale}`)
  if (sysInfo.userData) sections.push(`数据目录: ${sysInfo.userData}`)
  sections.push('')

  sections.push(`--- Info 日志 (共 ${infoLines.length} 条) ---`)
  sections.push(...infoLines)
  sections.push('')

  sections.push(`--- Error 日志 (共 ${errorLines.length} 条) ---`)
  sections.push(...errorLines)
  sections.push('')

  return sections.join('\n')
}

function buildJsonExport(
  sysInfo: SystemInfo,
  infoLines: string[],
  errorLines: string[],
): string {
  const allLines = infoLines
  const warnCount = allLines.filter((l) => l.includes('[WARN]')).length
  const infoCount = allLines.filter((l) => l.includes('[INFO]')).length
  const errorCount = errorLines.length

  const entries = allLines.map((line) => {
    const level = parseLogLevel(line)
    // 尝试解析结构化字段
    const tsMatch = line.match(/^\[([^\]]+)\]/)
    const srcMatch = line.match(/^\[[^\]]+\]\s*\[[^\]]+\]\s*\[([^\]]+)\]/)
    const msgStart = line.replace(/^\[[^\]]+\]\s*\[[^\]]+\]\s*\[[^\]]+\]\s*/, '')

    return {
      timestamp: tsMatch?.[1] ?? '',
      level,
      source: srcMatch?.[1] ?? '',
      message: msgStart,
    }
  })

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      systemInfo: sysInfo,
      summary: {
        totalEntries: allLines.length,
        infoCount,
        warnCount,
        errorCount,
      },
      entries,
    },
    null,
    2,
  )
}

export async function buildExportContent(format: LogExportFormat): Promise<string> {
  const sysInfo = collectSystemInfo()
  const infoLines = await readLogFile('info.log')
  const errorLines = await readLogFile('error.log')

  if (format === 'json') {
    return buildJsonExport(sysInfo, infoLines, errorLines)
  }
  return buildTextExport(sysInfo, infoLines, errorLines)
}
