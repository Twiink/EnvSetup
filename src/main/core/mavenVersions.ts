/**
 * 拉取并规范化可安装的 Maven 版本列表。
 */

const MAVEN_RELEASES_URL = 'https://api.github.com/repos/apache/maven/releases?per_page=5'

export const DEFAULT_MAVEN_VERSIONS = ['3.9.11', '3.9.10'] as const

type MavenReleaseEntry = {
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
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

export function normalizeMavenVersion(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined
  }

  const normalized = input.replace(/^maven-/, '').trim()
  return isSemver(normalized) ? normalized : undefined
}

export function normalizeMavenVersions(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  return [...new Set(
    input
      .filter(
        (entry): entry is MavenReleaseEntry =>
          typeof entry === 'object' && entry !== null && entry.draft !== true && entry.prerelease !== true,
      )
      .map((entry) => normalizeMavenVersion(entry.tag_name))
      .filter((version): version is string => typeof version === 'string'),
  )].sort(compareSemverDescending)
}

export async function fetchOfficialMavenVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const response = await fetchImpl(MAVEN_RELEASES_URL)

  if (!response.ok) {
    throw new Error(`Failed to load Maven releases from ${MAVEN_RELEASES_URL}`)
  }

  const payload = (await response.json()) as unknown
  const versions = normalizeMavenVersions(payload)

  if (versions.length === 0) {
    throw new Error('No official Maven versions were returned.')
  }

  return versions
}

export async function listMavenVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    return await fetchOfficialMavenVersions(fetchImpl)
  } catch {
    return [...DEFAULT_MAVEN_VERSIONS]
  }
}
