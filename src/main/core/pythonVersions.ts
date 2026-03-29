/**
 * Fetches and normalizes installable Python versions for templates and overrides.
 */

const PYTHON_EOL_API_URL = 'https://endoflife.date/api/python.json'

export const DEFAULT_PYTHON_VERSIONS = ['3.13.4', '3.12.10'] as const

type EndOfLifeEntry = {
  cycle?: unknown
  latest?: unknown
  eol?: unknown
  releaseDate?: unknown
}

const FETCH_TIMEOUT_MS = 8000

function isActiveRelease(entry: EndOfLifeEntry): boolean {
  if (typeof entry.eol === 'boolean') return !entry.eol
  if (typeof entry.eol === 'string') {
    const eolDate = new Date(entry.eol)
    return eolDate > new Date()
  }
  return false
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
}

function compareSemverDescending(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = left.split('.').map(Number)
  const [rightMajor, rightMinor, rightPatch] = right.split('.').map(Number)

  if (leftMajor !== rightMajor) return rightMajor - leftMajor
  if (leftMinor !== rightMinor) return rightMinor - leftMinor
  return rightPatch - leftPatch
}

export function normalizePythonVersions(input: unknown): string[] {
  if (!Array.isArray(input)) return []

  const versions: string[] = []

  for (const entry of input as EndOfLifeEntry[]) {
    if (!isActiveRelease(entry)) continue

    const latest = typeof entry.latest === 'string' ? entry.latest : ''
    if (isSemver(latest)) {
      versions.push(latest)
    }
  }

  return versions.sort(compareSemverDescending)
}

export async function fetchOfficialPythonVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchImpl(PYTHON_EOL_API_URL, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new Error(`Failed to load Python versions from ${PYTHON_EOL_API_URL}`)
  }

  const payload = (await response.json()) as unknown
  const versions = normalizePythonVersions(payload)

  if (versions.length === 0) {
    throw new Error('No active Python versions were returned.')
  }

  return versions
}

export async function listPythonVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    return await fetchOfficialPythonVersions(fetchImpl)
  } catch {
    return [...DEFAULT_PYTHON_VERSIONS]
  }
}
