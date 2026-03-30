/**
 * 拉取并规范化当前平台可安装的 Git 版本列表。
 */

const GIT_FOR_WINDOWS_RELEASES_URL =
  'https://api.github.com/repos/git-for-windows/git/releases?per_page=10'

export const DEFAULT_GIT_WINDOWS_VERSIONS = ['2.51.1', '2.50.1'] as const
export const DEFAULT_GIT_MACOS_VERSIONS = ['2.33.0', '2.32.0'] as const

type GitReleasePayload = {
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
}

type GitPlatform = 'darwin' | 'win32'

function currentPlatform(): GitPlatform {
  return process.platform === 'win32' ? 'win32' : 'darwin'
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
}

function compareSemverDescending(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = left.split('.').map(Number)
  const [rightMajor, rightMinor, rightPatch] = right.split('.').map(Number)

  if (leftMajor !== rightMajor) {
    return rightMajor - leftMajor
  }

  if (leftMinor !== rightMinor) {
    return rightMinor - leftMinor
  }

  return rightPatch - leftPatch
}

export function normalizeGitVersion(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined
  }

  const normalized = input.startsWith('v') ? input.slice(1) : input
  const match = normalized.match(/^(\d+\.\d+\.\d+)(?:\.windows\.\d+)?$/)
  return match?.[1] && isSemver(match[1]) ? match[1] : undefined
}

export function normalizeGitVersions(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  return [
    ...new Set(
      input
        .filter(
          (entry): entry is GitReleasePayload =>
            typeof entry === 'object' &&
            entry !== null &&
            entry.draft !== true &&
            entry.prerelease !== true,
        )
        .map((entry) => normalizeGitVersion(entry.tag_name))
        .filter((version): version is string => typeof version === 'string'),
    ),
  ].sort(compareSemverDescending)
}

export async function fetchOfficialGitVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const response = await fetchImpl(GIT_FOR_WINDOWS_RELEASES_URL)

  if (!response.ok) {
    throw new Error(`Failed to load Git releases from ${GIT_FOR_WINDOWS_RELEASES_URL}`)
  }

  const payload = (await response.json()) as unknown
  const versions = normalizeGitVersions(payload)

  if (versions.length === 0) {
    throw new Error('No official Git versions were returned.')
  }

  return versions.slice(0, 2)
}

export async function listGitVersions(
  platform: GitPlatform = currentPlatform(),
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  if (platform === 'darwin') {
    // macOS 直装仍依赖 git-osx-installer 的官方历史包，这里只暴露经过验证的两个稳定版本。
    return [...DEFAULT_GIT_MACOS_VERSIONS]
  }

  try {
    return await fetchOfficialGitVersions(fetchImpl)
  } catch {
    return [...DEFAULT_GIT_WINDOWS_VERSIONS]
  }
}
