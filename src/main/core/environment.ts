import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, parse, resolve } from 'node:path'
import { promisify } from 'node:util'

import type {
  CleanupEnvironmentResult,
  CleanupTransactionResult,
  DetectedEnvironment,
  EnvironmentTool,
  Primitive,
  ResolvedTemplate,
} from './contracts'
import {
  buildRemovePathCommand,
  executePlatformCommandWithElevationFallback,
  isPermissionError,
} from './elevation'
import { clearPersistedEnvKey } from './envPersistence'
import { mapTemplateValuesToPluginParams } from './template'

const SUPPORTED_ENVIRONMENT_CHECKS = new Set<EnvironmentTool>(['node', 'java', 'python', 'git'])
const execFileAsync = promisify(execFile)

type CleanupPlan = {
  detection: DetectedEnvironment
  trackedPaths: string[]
  removePaths: string[]
  clearEnvKeys: string[]
  commands: string[]
  profileSubstrings: string[]
}

const DEFAULT_UNIX_PROFILE_TARGETS = ['.zshrc', '.bash_profile', '.bashrc', '.profile']

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRootPath(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath)
  return normalizedPath === parse(normalizedPath).root
}

function isJenvShimPath(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath).toLowerCase()
  const separator = process.platform === 'win32' ? '\\' : '/'
  return (
    normalizedPath.includes(`${separator}jenv${separator}shims${separator}java`) ||
    normalizedPath.includes(`${separator}.jenv${separator}shims${separator}java`)
  )
}

function isPyenvShimPath(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath).toLowerCase()
  const separator = process.platform === 'win32' ? '\\' : '/'
  return (
    normalizedPath.includes(`${separator}pyenv${separator}shims${separator}python`) ||
    normalizedPath.includes(`${separator}.pyenv${separator}shims${separator}python`)
  )
}

function isNvmManagedPath(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath).toLowerCase()
  const separator = process.platform === 'win32' ? '\\' : '/'
  return normalizedPath.includes(`${separator}nvm`) || normalizedPath.includes(`${separator}.nvm`)
}

function isSdkmanManagedPath(targetPath: string): boolean {
  return resolve(targetPath).toLowerCase().includes('sdkman')
}

function isCondaManagedPath(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath).toLowerCase()
  return (
    normalizedPath.includes('miniconda') ||
    normalizedPath.includes('anaconda') ||
    normalizedPath.includes(`${process.platform === 'win32' ? '\\' : '/'}conda`) ||
    isNestedCondaEnv(normalizedPath)
  )
}

function inferNodeInstallRootFromExecutable(executablePath: string): string | undefined {
  const normalizedPath = resolve(executablePath)

  if (normalizedPath.endsWith('/bin/node')) {
    const candidate = dirname(dirname(normalizedPath))
    const candidateName = candidate.split('/').pop()?.toLowerCase() ?? ''
    if (
      candidateName.includes('node') ||
      candidateName.includes('nvm') ||
      normalizedPath.includes('/node-v') ||
      normalizedPath.includes('/nvm/')
    ) {
      return candidate
    }
  }

  if (normalizedPath.toLowerCase().endsWith('\\node.exe')) {
    const parentDir = dirname(normalizedPath)
    const parentName = parentDir.split(/[/\\]/).pop()?.toLowerCase() ?? ''
    if (parentName === 'node-current' || parentName.startsWith('node-v')) {
      return parentDir
    }
  }

  return undefined
}

function inferJavaHomeFromExecutable(executablePath: string): string | undefined {
  const normalizedPath = resolve(executablePath)

  if (normalizedPath.endsWith('/Contents/Home/bin/java')) {
    return normalizedPath.slice(0, -'/bin/java'.length)
  }

  if (normalizedPath.endsWith('/bin/java')) {
    const candidate = dirname(dirname(normalizedPath))
    const lowerCandidate = candidate.toLowerCase()
    if (
      lowerCandidate.includes('java') ||
      lowerCandidate.includes('jdk') ||
      lowerCandidate.includes('jre') ||
      lowerCandidate.includes('temurin') ||
      lowerCandidate.includes('corretto') ||
      lowerCandidate.includes('zulu') ||
      normalizedPath.includes('/JavaVirtualMachines/')
    ) {
      return candidate
    }
  }

  if (normalizedPath.toLowerCase().endsWith('\\bin\\java.exe')) {
    const candidate = dirname(dirname(normalizedPath))
    const lowerCandidate = candidate.toLowerCase()
    if (
      lowerCandidate.includes('java') ||
      lowerCandidate.includes('jdk') ||
      lowerCandidate.includes('jre') ||
      lowerCandidate.includes('temurin') ||
      lowerCandidate.includes('corretto') ||
      lowerCandidate.includes('zulu')
    ) {
      return candidate
    }
  }

  return undefined
}

function inferPythonInstallRootFromExecutable(executablePath: string): string | undefined {
  const normalizedPath = resolve(executablePath)

  if (
    normalizedPath.endsWith('/bin/python') ||
    normalizedPath.endsWith('/bin/python3') ||
    normalizedPath.endsWith('/bin/python3.12')
  ) {
    const candidate = dirname(dirname(normalizedPath))
    const lowerCandidate = candidate.toLowerCase()
    if (
      lowerCandidate.includes('python') ||
      lowerCandidate.includes('conda') ||
      lowerCandidate.includes('venv') ||
      lowerCandidate.includes('virtualenv') ||
      lowerCandidate.includes('pyenv') ||
      lowerCandidate.includes('anaconda')
    ) {
      return candidate
    }
  }

  if (
    normalizedPath.toLowerCase().endsWith('\\scripts\\python.exe') ||
    normalizedPath.toLowerCase().endsWith('\\python.exe')
  ) {
    const parentDir = dirname(normalizedPath)
    const parentName = parentDir.split(/[/\\]/).pop()?.toLowerCase() ?? ''
    return parentName === 'scripts' ? dirname(parentDir) : parentDir
  }

  return undefined
}

function inferGitInstallRootFromExecutable(executablePath: string): string | undefined {
  const normalizedPath = resolve(executablePath)

  if (normalizedPath.endsWith('/bin/git')) {
    const candidate = dirname(dirname(normalizedPath))
    const lowerCandidate = candidate.toLowerCase()
    if (lowerCandidate.includes('git') || normalizedPath.includes('/git/')) {
      return candidate
    }
  }

  if (
    normalizedPath.toLowerCase().endsWith('\\cmd\\git.exe') ||
    normalizedPath.toLowerCase().endsWith('\\bin\\git.exe')
  ) {
    const candidate = dirname(dirname(normalizedPath))
    const lowerCandidate = candidate.toLowerCase()
    if (lowerCandidate.includes('git') || normalizedPath.toLowerCase().includes('\\git\\')) {
      return candidate
    }
  }

  return undefined
}

function buildJenvRootCandidate(): string {
  return join(homedir(), '.jenv')
}

function buildPyenvRootCandidate(): string {
  return join(homedir(), '.pyenv')
}

function buildNvmRootCandidate(): string {
  return join(homedir(), '.nvm')
}

function isHomebrewGitExecutable(targetPath: string): boolean {
  if (process.platform !== 'darwin') {
    return false
  }

  const normalizedPath = resolve(targetPath)
  return (
    normalizedPath === '/opt/homebrew/bin/git' ||
    normalizedPath === '/usr/local/bin/git' ||
    normalizedPath.includes('/Cellar/git/') ||
    normalizedPath.includes('/Homebrew/Cellar/git/') ||
    normalizedPath.includes('/homebrew/opt/git/') ||
    normalizedPath.includes('/usr/local/opt/git/')
  )
}

function isScoopManagedPath(targetPath: string): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  return resolve(targetPath).toLowerCase().includes('\\scoop\\')
}

function isNestedCondaEnv(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath).toLowerCase()
  return process.platform === 'win32'
    ? normalizedPath.includes('\\envs\\')
    : normalizedPath.includes('/envs/')
}

async function resolveHomebrewGitPrefix(executablePath: string): Promise<string | undefined> {
  try {
    const realGitPath = await realpath(executablePath)
    const normalizedPath = resolve(realGitPath)
    const binSuffix = `${process.platform === 'win32' ? '\\' : '/'}bin${process.platform === 'win32' ? '\\' : '/'}git`
    if (normalizedPath.endsWith(binSuffix)) {
      return normalizedPath.slice(0, -binSuffix.length)
    }
  } catch {
    // 回退到 brew 查询
  }

  try {
    const { stdout } = await execFileAsync('/bin/sh', [
      '-c',
      'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions git >/dev/null 2>&1 && "$BREW_BIN" --prefix git; fi',
    ])
    const prefix = stdout.trim()
    return prefix.length > 0 ? prefix : undefined
  } catch {
    return undefined
  }
}

function resolveScoopGitPath(scoopRoot: string): string {
  const normalizedPath = resolve(scoopRoot)
  const lowerPath = normalizedPath.toLowerCase()
  return lowerPath.endsWith('\\apps\\git') || lowerPath.endsWith('/apps/git')
    ? normalizedPath
    : join(normalizedPath, 'apps', 'git')
}

function resolveSdkmanJavaPath(sdkmanPath: string): string {
  const normalizedPath = resolve(sdkmanPath)
  const javaSuffix = join('candidates', 'java')
  return normalizedPath.endsWith(javaSuffix)
    ? normalizedPath
    : join(normalizedPath, 'candidates', 'java')
}

function buildHomebrewGitCleanupCommand(): string {
  return 'BREW_BIN="$(command -v brew || true)"; if [ -z "$BREW_BIN" ]; then for CANDIDATE in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$CANDIDATE" ]; then BREW_BIN="$CANDIDATE"; break; fi; done; fi; if [ -n "$BREW_BIN" ]; then "$BREW_BIN" list --versions git >/dev/null 2>&1 && HOMEBREW_NO_AUTO_UPDATE=1 "$BREW_BIN" uninstall --formula git || true; fi'
}

function buildResolveScoopCommand(): string {
  return "$scoop = $null; $candidate = Join-Path $env:USERPROFILE 'scoop\\shims\\scoop.cmd'; if (Test-Path $candidate) { $scoop = $candidate }; if (-not $scoop) { $scoop = Get-Command 'scoop.cmd' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }; if (-not $scoop) { $scoop = Get-Command 'scoop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 1 }"
}

function buildScoopGitCleanupCommand(): string {
  return [
    buildResolveScoopCommand(),
    'if ($scoop) {',
    '$prefix = (& $scoop prefix git).Trim()',
    'if ($LASTEXITCODE -eq 0 -and $prefix) {',
    '& $scoop uninstall git *> $null',
    '$uninstallExitCode = $LASTEXITCODE',
    'if ($uninstallExitCode -ne 0) { throw "Scoop git uninstall failed with exit code $uninstallExitCode." }',
    '& $scoop prefix git *> $null',
    'if ($LASTEXITCODE -eq 0) {',
    '$gitParent = Split-Path $prefix -Parent',
    'if (Test-Path $gitParent) { Remove-Item -LiteralPath $gitParent -Recurse -Force }',
    '$shimDir = Split-Path $scoop -Parent',
    "foreach ($shimName in @('git.cmd', 'git.exe', 'git.ps1')) { $shimPath = Join-Path $shimDir $shimName; if (Test-Path $shimPath) { Remove-Item -LiteralPath $shimPath -Force } }",
    '& $scoop prefix git *> $null',
    "if ($LASTEXITCODE -eq 0) { throw 'Scoop git uninstall did not remove the installed prefix.' }",
    '}',
    '}',
    '}',
  ].join('; ')
}

function buildCondaEnvCleanupCommand(cleanupPath: string): string {
  if (process.platform === 'win32') {
    const windowsPath = cleanupPath.replace(/'/g, "''")
    const parentPath = resolve(cleanupPath, '..').replace(/'/g, "''")
    return [
      `$paths = @('${windowsPath}\\Scripts\\conda.exe', '${parentPath}\\Scripts\\conda.exe')`,
      '$conda = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1',
      `if ($conda) { & $conda env remove -y --prefix '${windowsPath}' *> $null }`,
    ].join('; ')
  }

  const quotedPath = cleanupPath.replace(/'/g, `'\\''`)
  const parentPath = resolve(cleanupPath, '..').replace(/'/g, `'\\''`)
  return `for CONDA_BIN in '${quotedPath}/bin/conda' '${parentPath}/bin/conda'; do if [ -x "$CONDA_BIN" ]; then "$CONDA_BIN" env remove -y --prefix '${quotedPath}' >/dev/null 2>&1 || true; break; fi; done`
}

async function runCleanupCommands(
  commands: string[],
): Promise<Array<{ path: string; error: string }>> {
  const errors: Array<{ path: string; error: string }> = []
  const platform = (process.platform === 'win32' ? 'win32' : 'darwin') as 'win32' | 'darwin'

  for (const [index, command] of commands.entries()) {
    try {
      await executePlatformCommandWithElevationFallback(command, platform)
    } catch (error) {
      errors.push({
        path: `command:${index + 1}`,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return errors
}

async function buildCleanupPlan(detection: DetectedEnvironment): Promise<CleanupPlan> {
  const trackedPaths: string[] = []
  const removePaths: string[] = []
  const clearEnvKeys = uniqueStrings([detection.cleanupEnvKey])
  const commands: string[] = []
  const profileSubstrings: string[] = []
  const resolvedCleanupPath =
    (await resolveExistingRealPath(detection.cleanupPath ?? detection.path)) ??
    detection.cleanupPath ??
    detection.path

  const addTrackedPaths = (...paths: Array<string | undefined>) => {
    trackedPaths.push(...uniqueStrings(paths))
  }
  const addRemovePaths = (...paths: Array<string | undefined>) => {
    removePaths.push(...uniqueStrings(paths.filter((path) => path && isCleanupAllowedPath(path))))
  }
  const addEnvKeys = (...keys: Array<string | undefined>) => {
    clearEnvKeys.push(...uniqueStrings(keys))
  }
  const addCommands = (...cleanupCommands: Array<string | undefined>) => {
    commands.push(...uniqueStrings(cleanupCommands))
  }
  const addProfileSubstrings = (...substrings: Array<string | undefined>) => {
    profileSubstrings.push(...uniqueStrings(substrings))
  }

  addTrackedPaths(resolvedCleanupPath)

  if (detection.tool === 'node') {
    if (
      detection.source === 'NVM_DIR' ||
      detection.source === 'NVM_HOME' ||
      isNvmManagedPath(resolvedCleanupPath)
    ) {
      const nvmRoot = await firstExistingPath(
        process.env.NVM_DIR,
        process.env.NVM_HOME,
        await resolvePersistedEnvValue('NVM_DIR'),
        await resolvePersistedEnvValue('NVM_HOME'),
        buildNvmRootCandidate(),
      )
      const nodeRoot = inferNodeInstallRootFromExecutable(resolvedCleanupPath)
      addTrackedPaths(nvmRoot, nodeRoot)
      addRemovePaths(nvmRoot, nodeRoot, resolvedCleanupPath)
      addEnvKeys('NVM_DIR', 'NVM_HOME', 'NVM_SYMLINK', 'NVM_NODEJS_ORG_MIRROR', 'npm_config_prefix')
      addProfileSubstrings('nvm.sh', nvmRoot, buildNvmRootCandidate(), 'NVM_DIR', 'NVM_HOME')
    } else {
      const nodeRoot = inferNodeInstallRootFromExecutable(resolvedCleanupPath)
      addTrackedPaths(nodeRoot)
      addRemovePaths(nodeRoot ?? resolvedCleanupPath)
      addEnvKeys('npm_config_prefix')
      addProfileSubstrings(nodeRoot, resolvedCleanupPath)
    }
  }

  if (detection.tool === 'java') {
    if (detection.source === 'SDKMAN_DIR' || isSdkmanManagedPath(resolvedCleanupPath)) {
      const sdkmanRoot = await firstExistingPath(
        process.env.SDKMAN_DIR,
        await resolvePersistedEnvValue('SDKMAN_DIR'),
      )
      const javaCandidatesDir = sdkmanRoot ? resolveSdkmanJavaPath(sdkmanRoot) : undefined
      const javaHome = inferJavaHomeFromExecutable(resolvedCleanupPath)
      addTrackedPaths(javaCandidatesDir, javaHome)
      addRemovePaths(javaCandidatesDir, javaHome, resolvedCleanupPath)
      addEnvKeys('SDKMAN_DIR', 'JAVA_HOME')
      addProfileSubstrings('sdkman-init.sh', sdkmanRoot, javaCandidatesDir, javaHome)
    } else if (detection.source === 'JAVA_HOME') {
      addRemovePaths(resolvedCleanupPath)
      addEnvKeys('JAVA_HOME')
      addProfileSubstrings(resolvedCleanupPath)
    } else if (isJenvShimPath(resolvedCleanupPath)) {
      const jenvRoot = await firstExistingPath(
        process.env.JENV_ROOT,
        await resolvePersistedEnvValue('JENV_ROOT'),
        buildJenvRootCandidate(),
      )
      const javaHome =
        process.env.JAVA_HOME ??
        (await resolvePersistedEnvValue('JAVA_HOME')) ??
        inferJavaHomeFromExecutable(resolvedCleanupPath)
      addTrackedPaths(jenvRoot, javaHome)
      addRemovePaths(jenvRoot, javaHome, resolvedCleanupPath)
      addEnvKeys('JAVA_HOME', 'JENV_ROOT')
      addProfileSubstrings('jenv init', '.jenv/shims', '.jenv/bin', jenvRoot, resolvedCleanupPath)
    } else {
      const javaHome = inferJavaHomeFromExecutable(resolvedCleanupPath)
      addTrackedPaths(javaHome)
      addRemovePaths(javaHome ?? resolvedCleanupPath)
      addEnvKeys('JAVA_HOME')
      addProfileSubstrings(javaHome, resolvedCleanupPath)
    }
  }

  if (detection.tool === 'python') {
    if (isPyenvShimPath(resolvedCleanupPath)) {
      const pyenvRoot = await firstExistingPath(
        process.env.PYENV_ROOT,
        await resolvePersistedEnvValue('PYENV_ROOT'),
        buildPyenvRootCandidate(),
      )
      const pythonRoot = inferPythonInstallRootFromExecutable(resolvedCleanupPath)
      addTrackedPaths(pyenvRoot, pythonRoot)
      addRemovePaths(pyenvRoot, pythonRoot, resolvedCleanupPath)
      addEnvKeys('PYENV_ROOT', 'VIRTUAL_ENV', 'CONDA_PREFIX')
      addProfileSubstrings(
        'pyenv init',
        '.pyenv/shims',
        '.pyenv/bin',
        pyenvRoot,
        resolvedCleanupPath,
      )
    } else if (detection.source === 'CONDA_PREFIX' || isCondaManagedPath(resolvedCleanupPath)) {
      const pythonRoot =
        detection.source === 'CONDA_PREFIX'
          ? resolvedCleanupPath
          : inferPythonInstallRootFromExecutable(resolvedCleanupPath)
      if (pythonRoot && isNestedCondaEnv(pythonRoot)) {
        addCommands(buildCondaEnvCleanupCommand(pythonRoot))
      }
      addTrackedPaths(pythonRoot)
      addRemovePaths(pythonRoot ?? resolvedCleanupPath)
      addEnvKeys('CONDA_PREFIX', 'VIRTUAL_ENV')
      addProfileSubstrings('conda shell', pythonRoot, 'miniconda', 'anaconda')
    } else {
      const pythonRoot = inferPythonInstallRootFromExecutable(resolvedCleanupPath)
      addTrackedPaths(pythonRoot)
      addRemovePaths(pythonRoot ?? resolvedCleanupPath)
      addEnvKeys('VIRTUAL_ENV')
      addProfileSubstrings(pythonRoot, resolvedCleanupPath)
    }
  }

  if (detection.tool === 'git') {
    if (detection.source === 'SCOOP' || isScoopManagedPath(resolvedCleanupPath)) {
      const scoopRoot = await firstExistingPath(
        process.env.SCOOP,
        await resolvePersistedEnvValue('SCOOP'),
        detection.cleanupPath,
      )
      const scoopGitPath = scoopRoot ? resolveScoopGitPath(scoopRoot) : resolvedCleanupPath
      addTrackedPaths(scoopGitPath)
      addRemovePaths(scoopGitPath, resolvedCleanupPath)
      addCommands(buildScoopGitCleanupCommand())
      addEnvKeys('SCOOP', 'GIT_HOME')
      addProfileSubstrings(scoopRoot, scoopGitPath)
    } else if (isHomebrewGitExecutable(resolvedCleanupPath)) {
      const homebrewGitPrefix = await resolveHomebrewGitPrefix(resolvedCleanupPath)
      addTrackedPaths(homebrewGitPrefix)
      addRemovePaths(homebrewGitPrefix, resolvedCleanupPath)
      addCommands(buildHomebrewGitCleanupCommand())
    } else {
      const gitRoot = inferGitInstallRootFromExecutable(resolvedCleanupPath)
      addTrackedPaths(gitRoot)
      addRemovePaths(gitRoot ?? resolvedCleanupPath)
      addEnvKeys('GIT_HOME')
      addProfileSubstrings(gitRoot, resolvedCleanupPath)
    }
  }

  return {
    detection,
    trackedPaths: uniqueStrings(trackedPaths),
    removePaths: uniqueStrings(removePaths),
    clearEnvKeys: uniqueStrings(clearEnvKeys),
    commands: uniqueStrings(commands),
    profileSubstrings: uniqueStrings(profileSubstrings),
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function firstExistingPath(...candidatePaths: string[]): Promise<string | undefined> {
  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath
    }
  }

  return undefined
}

async function listUnixProfilePaths(): Promise<string[]> {
  return DEFAULT_UNIX_PROFILE_TARGETS.map((target) => join(homedir(), target))
}

async function resolvePersistedEnvValue(key: string): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return undefined
  }

  const profilePaths = await listUnixProfilePaths()
  const exportRegex = new RegExp(
    `^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=\\s*["']?([^"'\\n]+)["']?\\s*$`,
    'm',
  )

  for (const profilePath of profilePaths) {
    try {
      const content = await readFile(profilePath, 'utf8')
      const matches = content.matchAll(new RegExp(exportRegex.source, 'gm'))
      const values = [...matches]
      if (values.length > 0) {
        return values.at(-1)?.[1]?.trim()
      }
    } catch {
      continue
    }
  }

  return undefined
}

async function clearUnixProfileSubstrings(substrings: string[]): Promise<void> {
  if (substrings.length === 0 || process.platform === 'win32') {
    return
  }

  const normalizedSubstrings = uniqueStrings(
    substrings.flatMap((substring) => {
      const normalizedPath = substring.includes('\\') ? substring.replace(/\\/g, '/') : undefined
      const windowsPath = substring.includes('/') ? substring.replace(/\//g, '\\') : undefined
      return [substring, normalizedPath, windowsPath]
    }),
  )

  const profilePaths = await listUnixProfilePaths()
  for (const profilePath of profilePaths) {
    let existing = ''
    try {
      existing = await readFile(profilePath, 'utf8')
    } catch {
      continue
    }

    const next = existing
      .split(/\r?\n/)
      .filter(
        (line) =>
          !normalizedSubstrings.some(
            (substring) => substring.length > 0 && line.includes(substring),
          ),
      )
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')

    if (next !== existing) {
      await writeFile(profilePath, next, 'utf8')
    }
  }
}

async function resolveExistingRealPath(targetPath: string): Promise<string | undefined> {
  try {
    return await realpath(targetPath)
  } catch {
    return await firstExistingPath(targetPath)
  }
}

function uniqueDetections(detections: DetectedEnvironment[]): DetectedEnvironment[] {
  const seen = new Set<string>()

  return detections.filter((detection) => {
    const key = `${detection.tool}:${detection.kind}:${detection.path}:${detection.source}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function splitExecutableCandidates(binary: string): string[] {
  if (process.platform === 'win32') {
    return [binary, `${binary}.exe`, `${binary}.cmd`, `${binary}.bat`]
  }

  return [binary]
}

function buildExecutableCacheKey(binaryNames: string[]): string {
  return [...binaryNames].sort().join('\u0000')
}

export async function findExecutable(
  binaryNames: string[],
  lookupCache?: Map<string, string | undefined>,
): Promise<string | undefined> {
  const cacheKey = buildExecutableCacheKey(binaryNames)
  if (lookupCache?.has(cacheKey)) {
    return lookupCache.get(cacheKey)
  }

  const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)

  for (const entry of entries) {
    for (const binaryName of binaryNames) {
      for (const candidate of splitExecutableCandidates(binaryName)) {
        const candidatePath = resolve(entry, candidate)
        try {
          await access(candidatePath, constants.X_OK)
          lookupCache?.set(cacheKey, candidatePath)
          return candidatePath
        } catch {
          continue
        }
      }
    }
  }

  lookupCache?.set(cacheKey, undefined)
  return undefined
}

export function isCleanupAllowedPath(targetPath: string): boolean {
  return typeof targetPath === 'string' && targetPath.trim().length > 0 && !isRootPath(targetPath)
}

function canCleanupDetection(cleanupPath?: string, cleanupEnvKey?: string): boolean {
  return Boolean(cleanupEnvKey) || Boolean(cleanupPath && isCleanupAllowedPath(cleanupPath))
}

function buildDetection(input: Omit<DetectedEnvironment, 'id'>): DetectedEnvironment {
  return {
    id: `${input.tool}:${input.kind}:${input.source}:${input.path}`,
    ...input,
  }
}

async function detectNodeEnvironment(
  values: Record<string, Primitive>,
  executableLookupCache?: Map<string, string | undefined>,
): Promise<DetectedEnvironment[]> {
  const detections: DetectedEnvironment[] = []
  const installRootDir =
    typeof values.installRootDir === 'string'
      ? values.installRootDir
      : typeof values['frontend.installRootDir'] === 'string'
        ? values['frontend.installRootDir']
        : undefined

  if (installRootDir && (await pathExists(installRootDir))) {
    detections.push(
      buildDetection({
        tool: 'node',
        kind: 'managed_root',
        path: installRootDir,
        source: 'frontend.installRootDir',
        cleanupSupported: isCleanupAllowedPath(installRootDir),
        cleanupPath: installRootDir,
      }),
    )
  }

  if (process.env.NVM_DIR) {
    detections.push(
      buildDetection({
        tool: 'node',
        kind: 'manager_root',
        path: process.env.NVM_DIR,
        source: 'NVM_DIR',
        cleanupSupported: canCleanupDetection(process.env.NVM_DIR, 'NVM_DIR'),
        cleanupPath: process.env.NVM_DIR,
        cleanupEnvKey: 'NVM_DIR',
      }),
    )
  }

  if (process.env.NVM_HOME) {
    detections.push(
      buildDetection({
        tool: 'node',
        kind: 'manager_root',
        path: process.env.NVM_HOME,
        source: 'NVM_HOME',
        cleanupSupported: canCleanupDetection(process.env.NVM_HOME, 'NVM_HOME'),
        cleanupPath: process.env.NVM_HOME,
        cleanupEnvKey: 'NVM_HOME',
      }),
    )
  }

  if (process.env.npm_config_prefix) {
    detections.push(
      buildDetection({
        tool: 'node',
        kind: 'global_prefix',
        path: process.env.npm_config_prefix,
        source: 'npm_config_prefix',
        cleanupSupported: canCleanupDetection(process.env.npm_config_prefix, 'npm_config_prefix'),
        cleanupPath: process.env.npm_config_prefix,
        cleanupEnvKey: 'npm_config_prefix',
      }),
    )
  }

  const nodeExecutable = await findExecutable(['node'], executableLookupCache)
  if (nodeExecutable) {
    detections.push(
      buildDetection({
        tool: 'node',
        kind: 'runtime_executable',
        path: nodeExecutable,
        source: 'PATH',
        cleanupSupported: canCleanupDetection(nodeExecutable),
        cleanupPath: nodeExecutable,
      }),
    )
  }

  return detections
}

async function detectJavaEnvironment(
  values: Record<string, Primitive>,
  executableLookupCache?: Map<string, string | undefined>,
): Promise<DetectedEnvironment[]> {
  const detections: DetectedEnvironment[] = []

  const installRootDir =
    typeof values.installRootDir === 'string'
      ? values.installRootDir
      : typeof values['java.installRootDir'] === 'string'
        ? values['java.installRootDir']
        : undefined

  if (installRootDir && (await pathExists(installRootDir))) {
    detections.push(
      buildDetection({
        tool: 'java',
        kind: 'managed_root',
        path: installRootDir,
        source: 'java.installRootDir',
        cleanupSupported: isCleanupAllowedPath(installRootDir),
        cleanupPath: installRootDir,
      }),
    )
  }

  if (process.env.SDKMAN_DIR) {
    const sdkmanJavaPath = await firstExistingPath(
      join(process.env.SDKMAN_DIR, 'candidates', 'java'),
      join(process.env.SDKMAN_DIR, 'candidates'),
    )

    if (sdkmanJavaPath) {
      detections.push(
        buildDetection({
          tool: 'java',
          kind: 'manager_root',
          path: sdkmanJavaPath,
          source: 'SDKMAN_DIR',
          cleanupSupported: canCleanupDetection(sdkmanJavaPath),
          cleanupPath: sdkmanJavaPath,
        }),
      )
    }
  }

  if (process.env.JAVA_HOME) {
    detections.push(
      buildDetection({
        tool: 'java',
        kind: 'runtime_home',
        path: process.env.JAVA_HOME,
        source: 'JAVA_HOME',
        cleanupSupported: canCleanupDetection(process.env.JAVA_HOME, 'JAVA_HOME'),
        cleanupPath: process.env.JAVA_HOME,
        cleanupEnvKey: 'JAVA_HOME',
      }),
    )
  }

  const javaExecutable = await findExecutable(['java'], executableLookupCache)
  if (javaExecutable) {
    detections.push(
      buildDetection({
        tool: 'java',
        kind: 'runtime_executable',
        path: javaExecutable,
        source: 'PATH',
        cleanupSupported: canCleanupDetection(javaExecutable),
        cleanupPath: javaExecutable,
      }),
    )
  }

  return detections
}

async function detectPythonEnvironment(
  values: Record<string, Primitive>,
  executableLookupCache?: Map<string, string | undefined>,
): Promise<DetectedEnvironment[]> {
  const detections: DetectedEnvironment[] = []

  const installRootDir =
    typeof values.installRootDir === 'string'
      ? values.installRootDir
      : typeof values['python.installRootDir'] === 'string'
        ? values['python.installRootDir']
        : undefined

  if (installRootDir && (await pathExists(installRootDir))) {
    detections.push(
      buildDetection({
        tool: 'python',
        kind: 'managed_root',
        path: installRootDir,
        source: 'python.installRootDir',
        cleanupSupported: isCleanupAllowedPath(installRootDir),
        cleanupPath: installRootDir,
      }),
    )
  }

  for (const envKey of ['VIRTUAL_ENV', 'PYENV_ROOT', 'CONDA_PREFIX'] as const) {
    const envPath = process.env[envKey]
    if (!envPath) {
      continue
    }

    detections.push(
      buildDetection({
        tool: 'python',
        kind: envKey === 'PYENV_ROOT' ? 'manager_root' : 'virtual_env',
        path: envPath,
        source: envKey,
        cleanupSupported: canCleanupDetection(envPath, envKey),
        cleanupPath: envPath,
        cleanupEnvKey: envKey,
      }),
    )
  }

  const pythonExecutable = await findExecutable(['python3', 'python', 'py'], executableLookupCache)
  if (pythonExecutable) {
    detections.push(
      buildDetection({
        tool: 'python',
        kind: 'runtime_executable',
        path: pythonExecutable,
        source: 'PATH',
        cleanupSupported: canCleanupDetection(pythonExecutable),
        cleanupPath: pythonExecutable,
      }),
    )
  }

  return detections
}

async function detectGitEnvironment(
  values: Record<string, Primitive>,
  executableLookupCache?: Map<string, string | undefined>,
): Promise<DetectedEnvironment[]> {
  const detections: DetectedEnvironment[] = []

  const installRootDir =
    typeof values.installRootDir === 'string'
      ? values.installRootDir
      : typeof values['git.installRootDir'] === 'string'
        ? values['git.installRootDir']
        : undefined

  if (installRootDir && (await pathExists(installRootDir))) {
    detections.push(
      buildDetection({
        tool: 'git',
        kind: 'managed_root',
        path: installRootDir,
        source: 'git.installRootDir',
        cleanupSupported: isCleanupAllowedPath(installRootDir),
        cleanupPath: installRootDir,
      }),
    )
  }

  for (const envKey of ['GIT_HOME', 'SCOOP'] as const) {
    const envPath = process.env[envKey]
    if (!envPath) {
      continue
    }

    const resolvedGitPath =
      envKey === 'SCOOP' ? await firstExistingPath(resolveScoopGitPath(envPath)) : envPath
    if (!resolvedGitPath) {
      continue
    }
    const cleanupEnvKey = envKey === 'SCOOP' && resolvedGitPath !== envPath ? undefined : envKey

    detections.push(
      buildDetection({
        tool: 'git',
        kind: 'manager_root',
        path: resolvedGitPath,
        source: envKey,
        cleanupSupported:
          envKey === 'SCOOP'
            ? canCleanupDetection(resolvedGitPath) || isScoopManagedPath(resolvedGitPath)
            : canCleanupDetection(resolvedGitPath, cleanupEnvKey),
        cleanupPath: resolvedGitPath,
        cleanupEnvKey,
      }),
    )
  }

  const gitExecutable = await findExecutable(['git'], executableLookupCache)
  if (gitExecutable) {
    detections.push(
      buildDetection({
        tool: 'git',
        kind: 'runtime_executable',
        path: gitExecutable,
        source: 'PATH',
        cleanupSupported: canCleanupDetection(gitExecutable),
        cleanupPath: gitExecutable,
      }),
    )
  }

  return detections
}

function resolveEnvironmentTargets(template: ResolvedTemplate): EnvironmentTool[] {
  const configuredChecks = template.checks.filter((check): check is EnvironmentTool =>
    SUPPORTED_ENVIRONMENT_CHECKS.has(check as EnvironmentTool),
  )

  if (configuredChecks.length > 0) {
    return configuredChecks
  }

  const targets: EnvironmentTool[] = []

  if (template.plugins.some((plugin) => plugin.pluginId === 'node-env')) {
    targets.push('node')
  }

  if (template.plugins.some((plugin) => plugin.pluginId === 'java-env')) {
    targets.push('java')
  }

  if (template.plugins.some((plugin) => plugin.pluginId === 'python-env')) {
    targets.push('python')
  }

  if (template.plugins.some((plugin) => plugin.pluginId === 'git-env')) {
    targets.push('git')
  }

  return targets
}

export async function detectTemplateEnvironments(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
): Promise<DetectedEnvironment[]> {
  const executableLookupCache = new Map<string, string | undefined>()

  const detections = await Promise.all(
    resolveEnvironmentTargets(template).map(async (target) => {
      if (target === 'node') {
        const detectionValues =
          template.id === 'node-template'
            ? mapTemplateValuesToPluginParams('node-env', values)
            : values
        return detectNodeEnvironment(detectionValues, executableLookupCache)
      }

      if (target === 'java') {
        const detectionValues = mapTemplateValuesToPluginParams('java-env', values)
        return detectJavaEnvironment(detectionValues, executableLookupCache)
      }

      if (target === 'python') {
        const detectionValues = mapTemplateValuesToPluginParams('python-env', values)
        return detectPythonEnvironment(detectionValues, executableLookupCache)
      }

      if (target === 'git') {
        const detectionValues = mapTemplateValuesToPluginParams('git-env', values)
        return detectGitEnvironment(detectionValues, executableLookupCache)
      }

      return []
    }),
  )

  return uniqueDetections(detections.flat())
}

export async function cleanupDetectedEnvironment(
  detection: DetectedEnvironment,
): Promise<CleanupEnvironmentResult> {
  if (!detection.cleanupSupported) {
    throw new Error(`Cleanup is not supported for ${detection.path}`)
  }

  const plan = await buildCleanupPlan(detection)
  const canExecute =
    plan.commands.length > 0 || plan.removePaths.length > 0 || plan.clearEnvKeys.length > 0

  if (!canExecute) {
    throw new Error(`Cleanup is not supported for ${detection.path}`)
  }

  const commandErrors = await runCleanupCommands(plan.commands)
  const removedPaths: string[] = []
  const removalErrors: Array<{ path: string; error: string }> = []
  const platform = (process.platform === 'win32' ? 'win32' : 'darwin') as 'win32' | 'darwin'

  for (const removePath of plan.removePaths) {
    const existedBeforeCleanup = await pathExists(removePath)
    try {
      await rm(removePath, { recursive: true, force: true })
    } catch (error) {
      if (!isPermissionError(error)) {
        removalErrors.push({
          path: removePath,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      try {
        await executePlatformCommandWithElevationFallback(
          buildRemovePathCommand(removePath, platform),
          platform,
        )
      } catch (elevatedError) {
        removalErrors.push({
          path: removePath,
          error: elevatedError instanceof Error ? elevatedError.message : String(elevatedError),
        })
        continue
      }
    }

    if (existedBeforeCleanup) {
      removedPaths.push(removePath)
    }
  }

  for (const envKey of plan.clearEnvKeys) {
    await clearPersistedEnvKey({
      key: envKey,
      platform: (process.platform === 'win32' ? 'win32' : 'darwin') as 'win32' | 'darwin',
    })
    delete process.env[envKey]
  }

  await clearUnixProfileSubstrings(plan.profileSubstrings)

  if (commandErrors.length > 0 || removalErrors.length > 0) {
    throw new Error([...commandErrors, ...removalErrors].map((error) => error.error).join(' | '))
  }

  const messageParts = []
  if (plan.commands.length > 0) {
    messageParts.push(`ran ${plan.commands.length} cleanup command(s)`)
  }
  if (removedPaths.length > 0) {
    messageParts.push(`removed ${removedPaths.join(', ')}`)
  }
  if (plan.clearEnvKeys.length > 0) {
    messageParts.push(`cleared ${plan.clearEnvKeys.join(', ')}`)
  }

  return {
    detectionId: detection.id,
    message: `Cleaned ${messageParts.join(' and ')}`,
    removedPath: removedPaths[0],
    clearedEnvKey: plan.clearEnvKeys[0],
    executedCommands: plan.commands,
  }
}

export async function cleanupDetectedEnvironments(
  detections: DetectedEnvironment[],
): Promise<Omit<CleanupTransactionResult, 'snapshotId'>> {
  const results: CleanupEnvironmentResult[] = []
  const errors: Array<{ path: string; error: string }> = []

  for (const detection of detections) {
    try {
      results.push(await cleanupDetectedEnvironment(detection))
    } catch (error) {
      errors.push({
        path: detection.path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    results,
    errors,
    message:
      errors.length > 0
        ? `Cleaned ${results.length} environment(s) with ${errors.length} error(s)`
        : `Successfully cleaned ${results.length} environment(s)`,
  }
}

export async function collectCleanupTrackedPaths(
  detections: DetectedEnvironment[],
): Promise<string[]> {
  const trackedPaths = await Promise.all(detections.map((detection) => buildCleanupPlan(detection)))
  return uniqueStrings(
    trackedPaths.flatMap((plan) =>
      plan.trackedPaths.filter((trackedPath) => trackedPath.length > 0),
    ),
  )
}
