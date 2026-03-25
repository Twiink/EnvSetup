const GIT_FOR_WINDOWS_RELEASE_URL =
  'https://api.github.com/repos/git-for-windows/git/releases/latest'

export const DEFAULT_GIT_VERSIONS = ['2.47.1'] as const

type GitReleasePayload = {
  tag_name?: unknown
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
}

export function normalizeGitVersion(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined
  }

  const normalized = input.startsWith('v') ? input.slice(1) : input
  return isSemver(normalized) ? normalized : undefined
}

export async function fetchOfficialGitVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(GIT_FOR_WINDOWS_RELEASE_URL)

  if (!response.ok) {
    throw new Error(`Failed to load Git release from ${GIT_FOR_WINDOWS_RELEASE_URL}`)
  }

  const payload = (await response.json()) as GitReleasePayload
  const version = normalizeGitVersion(payload.tag_name)

  if (!version) {
    throw new Error('No official Git version was returned.')
  }

  return version
}

export async function listGitVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    return [await fetchOfficialGitVersion(fetchImpl)]
  } catch {
    return [...DEFAULT_GIT_VERSIONS]
  }
}
