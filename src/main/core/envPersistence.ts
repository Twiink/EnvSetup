/**
 * 读取和写入用户保存的环境变量选择与覆盖项。
 */

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'

import type { AppPlatform, ApplyEnvChangesResult, EnvChange, EnvChangesPreview } from './contracts'

const execFileAsync = promisify(execFile)

const MANAGED_BLOCK_START = '# envsetup: managed block:start'
const MANAGED_BLOCK_END = '# envsetup: managed block:end'
const DEFAULT_UNIX_PROFILE_TARGETS = ['.zshrc', '.bash_profile', '.bashrc', '.profile']

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

export function previewEnvChanges(changes: EnvChange[]): EnvChangesPreview {
  const envCount = changes.filter((change) => change.kind === 'env').length
  const pathCount = changes.filter((change) => change.kind === 'path').length
  const profileCount = changes.filter((change) => change.kind === 'profile').length
  const targets = dedupe(changes.map((change) => change.target ?? change.key))

  return {
    envCount,
    pathCount,
    profileCount,
    targets,
  }
}

function mapProfileTarget(target?: string): string {
  if (!target || target === '~/.zshrc') {
    return join(homedir(), '.zshrc')
  }

  if (target === '~/.bash_profile') {
    return join(homedir(), '.bash_profile')
  }

  return target
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildManagedBlock(changes: EnvChange[]): string {
  const lines = changes.map((change) => {
    if (change.kind === 'profile') {
      return change.value
    }

    if (change.kind === 'path') {
      return `export PATH="${change.value}:$PATH"`
    }

    return `export ${change.key}="${change.value}"`
  })

  return [MANAGED_BLOCK_START, ...lines, MANAGED_BLOCK_END].join('\n')
}

async function writeShellProfile(profilePath: string, block: string): Promise<boolean> {
  let existing = ''
  try {
    existing = await readFile(profilePath, 'utf8')
  } catch {
    existing = ''
  }

  const escapedStart = MANAGED_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = MANAGED_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockRegex = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, 'g')
  const cleaned = existing.replace(blockRegex, '').trimEnd()
  const next = `${cleaned}\n${block}\n`

  if (next === existing) {
    return false
  }

  await writeFile(profilePath, next, 'utf8')
  return true
}

async function applyWindowsEnvChanges(changes: EnvChange[]): Promise<ApplyEnvChangesResult> {
  const applied: EnvChange[] = []
  const skipped: EnvChange[] = []

  for (const change of changes) {
    if (change.kind === 'profile') {
      skipped.push(change)
      continue
    }

    const key = change.kind === 'path' ? 'PATH' : change.key
    const value = change.value

    await execFileAsync('setx', [key, value])
    applied.push(change)
  }

  return { applied, skipped }
}

function removeEnvKeyFromShellContent(content: string, key: string): string {
  const escapedKey = escapeRegExp(key)
  const exportRegex = new RegExp(`^\\s*(?:export\\s+)?${escapedKey}\\s*=.*(?:\\r?\\n)?`, 'gm')
  const unsetRegex = new RegExp(`^\\s*unset\\s+${escapedKey}\\s*(?:\\r?\\n)?`, 'gm')
  const escapedStart = escapeRegExp(MANAGED_BLOCK_START)
  const escapedEnd = escapeRegExp(MANAGED_BLOCK_END)
  const emptyManagedBlockRegex = new RegExp(`\\n?${escapedStart}\\s*\\n${escapedEnd}\\n?`, 'g')

  return content
    .replace(exportRegex, '')
    .replace(unsetRegex, '')
    .replace(emptyManagedBlockRegex, '')
    .replace(/\n{3,}/g, '\n\n')
}

async function clearUnixEnvKey(key: string, profileTargets?: string[]): Promise<void> {
  const targets =
    profileTargets?.map(mapProfileTarget) ??
    DEFAULT_UNIX_PROFILE_TARGETS.map((target) => join(homedir(), target))

  for (const target of [...new Set(targets)]) {
    let existing = ''
    try {
      existing = await readFile(target, 'utf8')
    } catch {
      continue
    }

    const next = removeEnvKeyFromShellContent(existing, key)
    if (next !== existing) {
      await writeFile(target, next, 'utf8')
    }
  }
}

async function clearWindowsEnvKey(key: string): Promise<void> {
  await execFileAsync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `[Environment]::SetEnvironmentVariable(${quotePowerShellString(key)}, $null, 'User')`,
  ])
}

export async function clearPersistedEnvKey(options: {
  key: string
  platform: AppPlatform
  profileTargets?: string[]
}): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.key)) {
    throw new Error(`Invalid environment variable key: ${options.key}`)
  }

  if (options.platform === 'win32') {
    await clearWindowsEnvKey(options.key)
    return
  }

  await clearUnixEnvKey(options.key, options.profileTargets)
}

export async function applyEnvChanges(options: {
  changes: EnvChange[]
  platform: AppPlatform
}): Promise<ApplyEnvChangesResult> {
  const scopedChanges = options.changes.filter((change) => change.scope === 'user')

  if (options.platform === 'win32') {
    return applyWindowsEnvChanges(scopedChanges)
  }

  const grouped = new Map<string, EnvChange[]>()
  for (const change of scopedChanges) {
    const target = mapProfileTarget(change.target)
    const bucket = grouped.get(target) ?? []
    bucket.push(change)
    grouped.set(target, bucket)
  }

  const applied: EnvChange[] = []
  const skipped: EnvChange[] = []

  for (const [target, changes] of grouped.entries()) {
    const block = buildManagedBlock(changes)
    const wrote = await writeShellProfile(target, block)
    if (wrote) {
      applied.push(...changes)
    } else {
      skipped.push(...changes)
    }
  }

  return { applied, skipped }
}
