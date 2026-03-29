/**
 * 拉取并规范化可安装的 Java 与 LTS 版本列表。
 */

const ADOPTIUM_RELEASES_URL = 'https://api.adoptium.net/v3/info/available_releases'
const ADOPTIUM_LATEST_ASSETS_URL = 'https://api.adoptium.net/v3/assets/latest'

export const DEFAULT_JAVA_LTS_VERSIONS = ['21.0.6+7', '17.0.14+7'] as const

type AdoptiumAvailableReleases = {
  available_lts_releases?: unknown
}

type AdoptiumAssetEntry = {
  version?: {
    semver?: unknown
    openjdk_version?: unknown
  }
}

const FETCH_TIMEOUT_MS = 8000

async function fetchLatestVersionForFeature(
  featureVersion: number,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetchImpl(`${ADOPTIUM_LATEST_ASSETS_URL}/${featureVersion}/hotspot`, {
      signal: controller.signal,
    })
    if (!response.ok) return undefined

    const assets = (await response.json()) as AdoptiumAssetEntry[]
    if (!Array.isArray(assets) || assets.length === 0) return undefined

    const version = assets[0]?.version
    if (!version) return undefined

    const semver = typeof version.semver === 'string' ? version.semver : undefined
    const openjdkVersion =
      typeof version.openjdk_version === 'string' ? version.openjdk_version : undefined

    return semver ?? openjdkVersion ?? undefined
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchOfficialJavaLtsVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchImpl(ADOPTIUM_RELEASES_URL, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new Error(`Failed to load Adoptium releases from ${ADOPTIUM_RELEASES_URL}`)
  }

  const payload = (await response.json()) as AdoptiumAvailableReleases
  const ltsReleases = payload.available_lts_releases

  if (!Array.isArray(ltsReleases) || ltsReleases.length === 0) {
    throw new Error('No Adoptium LTS releases were returned.')
  }

  // 只保留较新的 LTS 主版本（>= 11）。
  const featureVersions = ltsReleases
    .filter((v): v is number => typeof v === 'number' && v >= 11)
    .sort((a, b) => b - a)

  const versions: string[] = []
  for (const featureVersion of featureVersions) {
    const latest = await fetchLatestVersionForFeature(featureVersion, fetchImpl)
    if (latest) {
      versions.push(latest)
    }
  }

  if (versions.length === 0) {
    throw new Error('No Adoptium LTS versions resolved.')
  }

  return versions
}

export function normalizeJavaLtsVersions(versions: string[]): string[] {
  return versions
    .filter((v) => typeof v === 'string' && v.length > 0)
    .sort((a, b) => {
      const aMajor = Number(a.split('.')[0])
      const bMajor = Number(b.split('.')[0])
      return bMajor - aMajor
    })
}

export async function listJavaLtsVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    return await fetchOfficialJavaLtsVersions(fetchImpl)
  } catch {
    return [...DEFAULT_JAVA_LTS_VERSIONS]
  }
}
