/**
 * 加载内置或导入插件、校验清单并准备插件执行状态。
 */

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import packageJson from '../../../package.json'
import type {
  AppPlatform,
  ImportedPlugin,
  PluginLifecycle,
  PluginManifest,
} from './contracts'
import { isLocalizedTextInput } from '../../shared/locale'

const execFileAsync = promisify(execFile)
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const EXECUTABLE_PLUGIN_ENTRY_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const DEFAULT_APP_VERSION = packageJson.version

function ensureObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function isPlatform(value: unknown): value is AppPlatform {
  return value === 'darwin' || value === 'win32'
}

function isSemverLike(value: string): boolean {
  return SEMVER_PATTERN.test(value)
}

function matchesVersionRange(version: string, range: string): boolean {
  if (range === '*' || range === '') {
    return true
  }

  if (range.startsWith('^')) {
    const target = range.slice(1)
    if (!isSemverLike(target) || !isSemverLike(version)) {
      return false
    }

    const [major, minor, patch] = version.split('.')
    const [targetMajor, targetMinor, targetPatch] = target.split('.')
    return (
      major === targetMajor &&
      (Number(minor) > Number(targetMinor) ||
        (minor === targetMinor && Number(patch) >= Number(targetPatch)))
    )
  }

  return version === range
}

async function assertEntryExists(pluginDir: string, entry: string): Promise<void> {
  await access(join(pluginDir, entry), constants.F_OK)
}

function assertExecutablePluginEntry(entry: string): void {
  if (!EXECUTABLE_PLUGIN_ENTRY_EXTENSIONS.has(extname(entry).toLowerCase())) {
    throw new Error(
      `Imported plugins must expose a JavaScript entry (${[...EXECUTABLE_PLUGIN_ENTRY_EXTENSIONS].join(', ')}): ${entry}`,
    )
  }
}

async function resolvePluginRoot(dir: string): Promise<string> {
  try {
    await access(join(dir, 'manifest.json'), constants.F_OK)
    return dir
  } catch {
    const entries = await readdir(dir, { withFileTypes: true })
    const directories = entries.filter((entry) => entry.isDirectory())

    if (directories.length === 1) {
      const nestedDir = join(dir, directories[0].name)
      await access(join(nestedDir, 'manifest.json'), constants.F_OK)
      return nestedDir
    }
  }

  throw new Error(`Cannot locate manifest.json in imported plugin: ${dir}`)
}

async function extractZipArchive(zipPath: string, stagingDir: string): Promise<string> {
  const baseName = basename(zipPath, extname(zipPath))
  const tempDir = await mkdtemp(join(stagingDir || tmpdir(), `${baseName}-`))

  if (process.platform === 'win32') {
    const command = [
      '& { param([string]$archivePathArg, [string]$destinationPathArg)',
      "$ErrorActionPreference = 'Stop'",
      '$archivePath = (Get-Item -LiteralPath $archivePathArg).FullName',
      '$destinationPath = (Get-Item -LiteralPath $destinationPathArg).FullName',
      'Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force',
      '}',
    ].join('; ')
    await execFileAsync('powershell', ['-NoProfile', '-Command', command, zipPath, tempDir])
    return resolvePluginRoot(tempDir)
  }

  if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-x', '-k', zipPath, tempDir])
    return resolvePluginRoot(tempDir)
  }

  await execFileAsync('unzip', ['-qq', zipPath, '-d', tempDir])
  return resolvePluginRoot(tempDir)
}

async function copyImportedPlugin(
  importedPlugin: ImportedPlugin,
  registryDir?: string,
): Promise<ImportedPlugin> {
  if (!registryDir) {
    return importedPlugin
  }

  const destination = join(registryDir, importedPlugin.manifest.id, importedPlugin.manifest.version)
  await mkdir(join(registryDir, importedPlugin.manifest.id), { recursive: true })
  await cp(importedPlugin.sourcePath, destination, { recursive: true, force: true })
  return {
    ...importedPlugin,
    storagePath: destination,
  }
}

function normalizeVersionParts(version: string): number[] {
  return version
    .split(/[-+.]/)
    .map((segment) => Number(segment))
    .filter((segment) => Number.isFinite(segment))
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersionParts(left)
  const rightParts = normalizeVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue !== rightValue) {
      return leftValue - rightValue
    }
  }

  return left.localeCompare(right)
}

export function validatePluginManifest(input: unknown, appVersion = DEFAULT_APP_VERSION): PluginManifest {
  const manifest = ensureObject(input, 'Plugin manifest must be an object.')
  const {
    id,
    name,
    version,
    mainAppVersion,
    platforms,
    permissions,
    parameters,
    dependencies,
    entry,
  } = manifest

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Plugin manifest requires a valid id.')
  }

  if (!isLocalizedTextInput(name)) {
    throw new Error('Plugin manifest requires a valid name.')
  }

  if (typeof version !== 'string' || !isSemverLike(version)) {
    throw new Error('Plugin manifest requires a semver version.')
  }

  if (typeof mainAppVersion !== 'string' || !matchesVersionRange(appVersion, mainAppVersion)) {
    throw new Error('Plugin manifest is incompatible with this app version.')
  }

  if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every(isPlatform)) {
    throw new Error('Plugin manifest requires supported platforms.')
  }

  if (!platforms.includes(process.platform as AppPlatform)) {
    throw new Error(`Plugin ${id} does not support ${process.platform}.`)
  }

  if (!Array.isArray(permissions) || permissions.some((value) => typeof value !== 'string')) {
    throw new Error('Plugin manifest permissions must be a string array.')
  }

  if (typeof entry !== 'string' || entry.length === 0) {
    throw new Error('Plugin manifest requires an entry file.')
  }

  ensureObject(parameters, 'Plugin manifest parameters must be an object.')

  if (!Array.isArray(dependencies)) {
    throw new Error('Plugin manifest dependencies must be an array.')
  }

  return {
    id,
    name,
    version,
    mainAppVersion,
    platforms,
    permissions,
    parameters: parameters as PluginManifest['parameters'],
    dependencies: dependencies as PluginManifest['dependencies'],
    entry,
  }
}

export function normalizeImportedPlugin(
  sourcePath: string,
  manifest: PluginManifest,
  storagePath?: string,
): ImportedPlugin {
  return {
    manifest,
    sourcePath,
    entryPath: join(sourcePath, manifest.entry),
    importedAt: new Date().toISOString(),
    storagePath,
  }
}

export async function importPluginFromDirectory(
  dir: string,
  options?: {
    registryDir?: string
    appVersion?: string
  },
): Promise<ImportedPlugin> {
  const directoryStat = await stat(dir)
  if (!directoryStat.isDirectory()) {
    throw new Error(`Plugin path must be a directory: ${dir}`)
  }

  const manifestRaw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as unknown
  const manifest = validatePluginManifest(manifestRaw, options?.appVersion)
  await assertEntryExists(dir, manifest.entry)
  assertExecutablePluginEntry(manifest.entry)

  const normalized = normalizeImportedPlugin(dir, manifest)
  return copyImportedPlugin(normalized, options?.registryDir)
}

export async function importPluginFromZip(
  zipPath: string,
  stagingDir: string,
  options?: {
    registryDir?: string
    appVersion?: string
  },
): Promise<ImportedPlugin> {
  const pluginDir = await extractZipArchive(zipPath, stagingDir)
  return importPluginFromDirectory(pluginDir, options)
}

async function readImportedPlugin(
  pluginDir: string,
  appVersion?: string,
): Promise<ImportedPlugin | undefined> {
  try {
    const manifestRaw = JSON.parse(await readFile(join(pluginDir, 'manifest.json'), 'utf8')) as unknown
    const manifest = validatePluginManifest(manifestRaw, appVersion)
    await assertEntryExists(pluginDir, manifest.entry)
    assertExecutablePluginEntry(manifest.entry)
    return normalizeImportedPlugin(pluginDir, manifest, pluginDir)
  } catch {
    return undefined
  }
}

export async function listImportedPluginsFromRegistry(
  registryDir: string,
  options?: { appVersion?: string },
): Promise<ImportedPlugin[]> {
  try {
    const pluginEntries = await readdir(registryDir, { withFileTypes: true })
    const importedPlugins: ImportedPlugin[] = []

    for (const pluginEntry of pluginEntries) {
      if (!pluginEntry.isDirectory()) {
        continue
      }

      const pluginVersionsDir = join(registryDir, pluginEntry.name)
      const versionEntries = await readdir(pluginVersionsDir, { withFileTypes: true })

      for (const versionEntry of versionEntries) {
        if (!versionEntry.isDirectory()) {
          continue
        }

        const importedPlugin = await readImportedPlugin(
          join(pluginVersionsDir, versionEntry.name),
          options?.appVersion,
        )
        if (importedPlugin) {
          importedPlugins.push(importedPlugin)
        }
      }
    }

    return importedPlugins.sort((left, right) => {
      if (left.manifest.id !== right.manifest.id) {
        return left.manifest.id.localeCompare(right.manifest.id)
      }

      return compareVersions(right.manifest.version, left.manifest.version)
    })
  } catch {
    return []
  }
}

function isPluginLifecycle(value: unknown): value is PluginLifecycle {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return 'install' in value && 'verify' in value
}

export async function loadPluginLifecycle(importedPlugin: ImportedPlugin): Promise<PluginLifecycle> {
  const entryPath = importedPlugin.storagePath
    ? join(importedPlugin.storagePath, importedPlugin.manifest.entry)
    : importedPlugin.entryPath
  const entryStat = await stat(entryPath)
  const moduleRef = `${pathToFileURL(entryPath).href}?mtime=${entryStat.mtimeMs}`
  const loadedModule = (await import(moduleRef)) as { default?: unknown }
  const pluginLifecycle = loadedModule.default ?? loadedModule

  if (!isPluginLifecycle(pluginLifecycle)) {
    throw new Error(`Imported plugin ${importedPlugin.manifest.id} does not export a valid lifecycle`)
  }

  return pluginLifecycle
}
