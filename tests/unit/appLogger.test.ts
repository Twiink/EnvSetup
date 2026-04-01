/**
 * appLogger 单元测试：写入、脱敏、系统信息、导出格式、轮转。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildExportContent,
  collectSystemInfo,
  initAppLogger,
  logError,
  logInfo,
  logWarn,
  writeLog,
} from '../../src/main/core/appLogger'

let testDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `applogger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(testDir, { recursive: true })
  initAppLogger(testDir)
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function readLogLines(fileName: string): Promise<string[]> {
  try {
    const content = await readFile(join(testDir, fileName), 'utf8')
    return content.split('\n').filter((l) => l.length > 0)
  } catch {
    return []
  }
}

async function waitForFlush(): Promise<void> {
  // 日志写入是 fire-and-forget，给一点时间让 I/O 完成
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('logInfo', () => {
  it('writes to info.log', async () => {
    logInfo('test', 'hello world')
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('[INFO]')
    expect(lines[0]).toContain('[test]')
    expect(lines[0]).toContain('hello world')
  })

  it('includes context in log line', async () => {
    logInfo('test', 'with context', { key: 'value' })
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines[0]).toContain('"key":"value"')
  })

  it('does not write to error.log', async () => {
    logInfo('test', 'info only')
    await waitForFlush()

    const errorLines = await readLogLines('error.log')
    expect(errorLines.length).toBe(0)
  })
})

describe('logWarn', () => {
  it('writes WARN level to info.log', async () => {
    logWarn('test', 'warning message')
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('[WARN]')
    expect(lines[0]).toContain('warning message')
  })
})

describe('logError', () => {
  it('writes to both info.log and error.log', async () => {
    logError('test', 'something broke', { error: new Error('boom') })
    await waitForFlush()

    const infoLines = await readLogLines('info.log')
    const errorLines = await readLogLines('error.log')
    expect(infoLines.length).toBe(1)
    expect(errorLines.length).toBe(1)
    expect(infoLines[0]).toContain('[ERROR]')
    expect(errorLines[0]).toContain('[ERROR]')
    expect(errorLines[0]).toContain('boom')
  })

  it('extracts error name, message, and stack', async () => {
    const err = new Error('test error')
    err.name = 'CustomError'
    logError('test', 'failed', { error: err })
    await waitForFlush()

    const lines = await readLogLines('error.log')
    expect(lines[0]).toContain('CustomError')
    expect(lines[0]).toContain('test error')
  })

  it('handles non-Error objects', async () => {
    logError('test', 'failed', { error: 'string error' })
    await waitForFlush()

    const lines = await readLogLines('error.log')
    expect(lines[0]).toContain('string error')
  })
})

describe('writeLog', () => {
  it('routes info level to info.log', async () => {
    writeLog({ level: 'info', source: 'renderer', message: 'user clicked' })
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('[INFO]')
  })

  it('routes error level to both files', async () => {
    writeLog({ level: 'error', source: 'renderer', message: 'crash' })
    await waitForFlush()

    const infoLines = await readLogLines('info.log')
    const errorLines = await readLogLines('error.log')
    expect(infoLines.length).toBe(1)
    expect(errorLines.length).toBe(1)
  })

  it('routes warn level to info.log', async () => {
    writeLog({ level: 'warn', source: 'renderer', message: 'caution' })
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines[0]).toContain('[WARN]')
  })
})

describe('sanitizeLog integration', () => {
  it('redacts sensitive key=value pairs', async () => {
    logInfo('test', 'config', { note: 'token=abc123secret' })
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines[0]).not.toContain('abc123secret')
    expect(lines[0]).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens', async () => {
    logInfo('test', 'auth header: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')
    await waitForFlush()

    const lines = await readLogLines('info.log')
    expect(lines[0]).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(lines[0]).toContain('[REDACTED]')
  })
})

describe('collectSystemInfo', () => {
  it('returns all required fields', () => {
    const info = collectSystemInfo()
    expect(info.platform).toBe(process.platform)
    expect(info.arch).toBe(process.arch)
    expect(typeof info.osVersion).toBe('string')
    expect(typeof info.osRelease).toBe('string')
    expect(typeof info.cpuModel).toBe('string')
    expect(info.cpuCores).toBeGreaterThan(0)
    expect(info.totalMemory).toBeGreaterThan(0)
    expect(info.freeMemory).toBeGreaterThan(0)
    expect(info.nodeVersion).toBe(process.versions.node)
  })
})

describe('buildExportContent', () => {
  beforeEach(async () => {
    logInfo('test', 'info entry one')
    logInfo('test', 'info entry two')
    logWarn('test', 'warn entry')
    logError('test', 'error entry', { error: new Error('fail') })
    await waitForFlush()
  })

  it('builds text format with system info and log sections', async () => {
    const content = await buildExportContent('text')
    expect(content).toContain('EnvSetup 诊断日志导出')
    expect(content).toContain('--- 系统信息 ---')
    expect(content).toContain(`平台: ${process.platform}`)
    expect(content).toContain('--- Info 日志')
    expect(content).toContain('--- Error 日志')
    expect(content).toContain('info entry one')
    expect(content).toContain('error entry')
  })

  it('builds JSON format with structured data', async () => {
    const content = await buildExportContent('json')
    const parsed = JSON.parse(content)
    expect(parsed.exportedAt).toBeDefined()
    expect(parsed.systemInfo.platform).toBe(process.platform)
    expect(parsed.summary.totalEntries).toBeGreaterThanOrEqual(4)
    expect(parsed.entries.length).toBeGreaterThanOrEqual(4)
    expect(parsed.summary.errorCount).toBeGreaterThanOrEqual(1)
  })
})

describe('log rotation', () => {
  it('rotates info.log when it exceeds 5 MB', async () => {
    // 写一个刚好超过 5 MB 的文件来触发轮转
    const bigContent = 'x'.repeat(5 * 1024 * 1024 + 1)
    await writeFile(join(testDir, 'info.log'), bigContent, 'utf8')

    logInfo('test', 'after rotation')
    await waitForFlush()

    const files = await readdir(testDir)
    const infoFiles = files.filter((f) => f.startsWith('info'))
    // 应该有原始的 info.{timestamp}.log 和新的 info.log
    expect(infoFiles.length).toBeGreaterThanOrEqual(2)

    // 新的 info.log 应该只包含轮转后的新条目
    const newContent = await readFile(join(testDir, 'info.log'), 'utf8')
    expect(newContent).toContain('after rotation')
    expect(newContent.length).toBeLessThan(5 * 1024 * 1024)
  })
})
