import { constants } from 'node:fs'
import { access, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'

import type {
  CleanupEnvironmentResult,
  DetectedEnvironment,
  EnvironmentTool,
  Primitive,
  ResolvedTemplate,
} from './contracts'
import { mapTemplateValuesToPluginParams } from './template'

const SUPPORTED_ENVIRONMENT_CHECKS = new Set<EnvironmentTool>(['node', 'java', 'python', 'git'])

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
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

async function findExecutable(binaryNames: string[]): Promise<string | undefined> {
  const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)

  for (const entry of entries) {
    for (const binaryName of binaryNames) {
      for (const candidate of splitExecutableCandidates(binaryName)) {
        const candidatePath = resolve(entry, candidate)
        try {
          await access(candidatePath, constants.X_OK)
          return candidatePath
        } catch {
          continue
        }
      }
    }
  }

  return undefined
}

function isCleanupAllowedPath(targetPath: string): boolean {
  const normalizedPath = resolve(targetPath)
  const userHome = resolve(homedir())
  const tempRoot = resolve(tmpdir())
  const workspaceRoot = resolve(process.cwd())
  const protectedRoots =
    process.platform === 'win32'
      ? [
          resolve(process.env.SystemRoot ?? 'C:\\Windows'),
          resolve(process.env['ProgramFiles'] ?? 'C:\\Program Files'),
          resolve(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'),
        ]
      : ['/System', '/usr', '/bin', '/sbin', '/opt', '/Library'].map((path) => resolve(path))

  if (
    !normalizedPath.startsWith(userHome) &&
    !normalizedPath.startsWith(tempRoot) &&
    !normalizedPath.startsWith(workspaceRoot)
  ) {
    return false
  }

  return !protectedRoots.some(
    (protectedRoot) =>
      normalizedPath === protectedRoot ||
      normalizedPath.startsWith(`${protectedRoot}${process.platform === 'win32' ? '\\' : '/'}`),
  )
}

function buildDetection(input: Omit<DetectedEnvironment, 'id'>): DetectedEnvironment {
  return {
    id: `${input.tool}:${input.kind}:${input.source}:${input.path}`,
    ...input,
  }
}

async function detectNodeEnvironment(
  values: Record<string, Primitive>,
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
        cleanupSupported: isCleanupAllowedPath(process.env.NVM_DIR),
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
        cleanupSupported: isCleanupAllowedPath(process.env.NVM_HOME),
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
        cleanupSupported: isCleanupAllowedPath(process.env.npm_config_prefix),
        cleanupPath: process.env.npm_config_prefix,
        cleanupEnvKey: 'npm_config_prefix',
      }),
    )
  }

  const nodeExecutable = await findExecutable(['node'])
  if (nodeExecutable) {
    detections.push(
      buildDetection({
        tool: 'node',
        kind: 'runtime_executable',
        path: nodeExecutable,
        source: 'PATH',
        cleanupSupported: false,
      }),
    )
  }

  return detections
}

async function detectJavaEnvironment(
  values: Record<string, Primitive>,
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
    detections.push(
      buildDetection({
        tool: 'java',
        kind: 'manager_root',
        path: process.env.SDKMAN_DIR,
        source: 'SDKMAN_DIR',
        cleanupSupported: isCleanupAllowedPath(process.env.SDKMAN_DIR),
        cleanupPath: process.env.SDKMAN_DIR,
        cleanupEnvKey: 'SDKMAN_DIR',
      }),
    )
  }

  if (process.env.JAVA_HOME) {
    detections.push(
      buildDetection({
        tool: 'java',
        kind: 'runtime_home',
        path: process.env.JAVA_HOME,
        source: 'JAVA_HOME',
        cleanupSupported: isCleanupAllowedPath(process.env.JAVA_HOME),
        cleanupPath: process.env.JAVA_HOME,
        cleanupEnvKey: 'JAVA_HOME',
      }),
    )
  }

  const javaExecutable = await findExecutable(['java'])
  if (javaExecutable) {
    detections.push(
      buildDetection({
        tool: 'java',
        kind: 'runtime_executable',
        path: javaExecutable,
        source: 'PATH',
        cleanupSupported: false,
      }),
    )
  }

  return detections
}

async function detectPythonEnvironment(
  values: Record<string, Primitive>,
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
        cleanupSupported: isCleanupAllowedPath(envPath),
        cleanupPath: envPath,
        cleanupEnvKey: envKey,
      }),
    )
  }

  const pythonExecutable = await findExecutable(['python3', 'python', 'py'])
  if (pythonExecutable) {
    detections.push(
      buildDetection({
        tool: 'python',
        kind: 'runtime_executable',
        path: pythonExecutable,
        source: 'PATH',
        cleanupSupported: false,
      }),
    )
  }

  return detections
}

async function detectGitEnvironment(values: Record<string, Primitive>): Promise<DetectedEnvironment[]> {
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

    detections.push(
      buildDetection({
        tool: 'git',
        kind: 'manager_root',
        path: envPath,
        source: envKey,
        cleanupSupported: isCleanupAllowedPath(envPath),
        cleanupPath: envPath,
        cleanupEnvKey: envKey,
      }),
    )
  }

  const gitExecutable = await findExecutable(['git'])
  if (gitExecutable) {
    detections.push(
      buildDetection({
        tool: 'git',
        kind: 'runtime_executable',
        path: gitExecutable,
        source: 'PATH',
        cleanupSupported: false,
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
  const detections: DetectedEnvironment[] = []

  for (const target of resolveEnvironmentTargets(template)) {
    if (target === 'node') {
      const detectionValues =
        template.id === 'node-template'
          ? mapTemplateValuesToPluginParams('node-env', values)
          : values
      detections.push(...(await detectNodeEnvironment(detectionValues)))
      continue
    }

    if (target === 'java') {
      const detectionValues = mapTemplateValuesToPluginParams('java-env', values)
      detections.push(...(await detectJavaEnvironment(detectionValues)))
      continue
    }

    if (target === 'python') {
      const detectionValues = mapTemplateValuesToPluginParams('python-env', values)
      detections.push(...(await detectPythonEnvironment(detectionValues)))
      continue
    }

    if (target === 'git') {
      const detectionValues = mapTemplateValuesToPluginParams('git-env', values)
      detections.push(...(await detectGitEnvironment(detectionValues)))
    }
  }

  return uniqueDetections(detections)
}

export async function cleanupDetectedEnvironment(
  detection: DetectedEnvironment,
): Promise<CleanupEnvironmentResult> {
  if (!detection.cleanupSupported || !detection.cleanupPath) {
    throw new Error(`Cleanup is not supported for ${detection.path}`)
  }

  if (!isCleanupAllowedPath(detection.cleanupPath)) {
    throw new Error(`Refusing to clean a protected path: ${detection.cleanupPath}`)
  }

  await rm(detection.cleanupPath, { recursive: true, force: true })

  if (detection.cleanupEnvKey) {
    delete process.env[detection.cleanupEnvKey]
  }

  return {
    message: `Cleaned ${detection.cleanupPath}`,
    removedPath: detection.cleanupPath,
    clearedEnvKey: detection.cleanupEnvKey,
  }
}
