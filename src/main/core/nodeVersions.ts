/**
 * 拉取并规范化可安装的 Node.js 版本列表。
 */

const NODE_DIST_INDEX_URL = 'https://nodejs.org/dist/index.json'

export const DEFAULT_NODE_LTS_VERSIONS = ['24.13.1', '22.22.1', '20.20.1'] as const

type NodeDistIndexEntry = {
  version?: unknown
  lts?: unknown
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

export function normalizeNodeLtsVersions(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  const latestPerMajor = new Map<number, string>()

  for (const entry of input as NodeDistIndexEntry[]) {
    const rawVersion = typeof entry.version === 'string' ? entry.version : ''
    const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion

    if (!isSemver(version) || !entry.lts) {
      continue
    }

    const major = Number(version.split('.')[0])
    const existingVersion = latestPerMajor.get(major)

    if (!existingVersion || compareSemverDescending(existingVersion, version) > 0) {
      latestPerMajor.set(major, version)
    }
  }

  return [...latestPerMajor.values()].sort(compareSemverDescending)
}

const FETCH_TIMEOUT_MS = 8000

export async function fetchOfficialNodeLtsVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchImpl(NODE_DIST_INDEX_URL, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new Error(`Failed to load Node.js releases from ${NODE_DIST_INDEX_URL}`)
  }

  const payload = (await response.json()) as unknown
  const versions = normalizeNodeLtsVersions(payload)

  if (versions.length === 0) {
    throw new Error('No official Node.js LTS versions were returned.')
  }

  return versions
}

export async function listNodeLtsVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    return await fetchOfficialNodeLtsVersions(fetchImpl)
  } catch {
    return [...DEFAULT_NODE_LTS_VERSIONS]
  }
}
