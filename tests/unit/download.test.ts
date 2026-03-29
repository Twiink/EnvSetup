/**
 * download 模块的单元测试。
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { DownloadArtifact } from '../../src/main/core/contracts'
import { downloadArtifacts, validateOfficialDownloads } from '../../src/main/core/download'

function textResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
}

describe('downloadArtifacts', () => {
  it('rejects untrusted installer hosts during validation', () => {
    const downloads: DownloadArtifact[] = [
      {
        kind: 'installer',
        tool: 'sdkman',
        url: 'https://example.com/sdkman-install.sh',
        official: true,
      },
    ]

    expect(() => validateOfficialDownloads(downloads)).toThrow('Unofficial download host')
  })

  it('rejects untrusted download host', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'envsetup-download-'))
    const downloads: DownloadArtifact[] = [
      {
        kind: 'archive',
        tool: 'node',
        url: 'https://example.com/node.tar.gz',
        official: true,
      },
    ]

    await expect(
      downloadArtifacts({
        downloads,
        cacheDir,
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_HOST_UNTRUSTED' })
  })

  it('fails with DOWNLOAD_CHECKSUM_FAILED when checksum mismatches', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'envsetup-download-'))
    const downloads: DownloadArtifact[] = [
      {
        kind: 'archive',
        tool: 'node',
        url: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz',
        official: true,
        checksumUrl: 'https://nodejs.org/dist/v20.11.1/SHASUMS256.txt',
        checksumAlgorithm: 'sha256',
      },
    ]

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('SHASUMS256.txt')) {
        return textResponse('deadbeef  node-v20.11.1-darwin-arm64.tar.gz\n')
      }
      return new Response(Buffer.from('actual-content'), { status: 200 })
    })

    await expect(
      downloadArtifacts({
        downloads,
        cacheDir,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_CHECKSUM_FAILED' })
  })

  it('uses cached file on second download without refetching archive', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'envsetup-download-'))
    const downloads: DownloadArtifact[] = [
      {
        kind: 'archive',
        tool: 'node',
        url: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz',
        official: true,
      },
    ]

    const fetchImpl = vi.fn(
      async () => new Response(Buffer.from('archive-content'), { status: 200 }),
    )

    const first = await downloadArtifacts({ downloads, cacheDir, fetchImpl })
    expect(first[0].cacheHit).toBe(false)

    fetchImpl.mockClear()
    const second = await downloadArtifacts({ downloads, cacheDir, fetchImpl })

    expect(second[0].cacheHit).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()

    const cached = await readFile(second[0].localPath)
    expect(cached.toString()).toBe('archive-content')
  })

  it('retries failed downloads and succeeds on later attempt', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'envsetup-download-'))
    const downloads: DownloadArtifact[] = [
      {
        kind: 'archive',
        tool: 'node',
        url: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz',
        official: true,
      },
    ]

    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error('network down')
      }
      return new Response(Buffer.from('ok'), { status: 200 })
    })

    const result = await downloadArtifacts({
      downloads,
      cacheDir,
      fetchImpl,
      retryCount: 2,
    })

    expect(result[0].cacheHit).toBe(false)
    expect(attempts).toBe(3)
  })

  it('throws DOWNLOAD_RETRY_EXHAUSTED after retries are exhausted', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'envsetup-download-'))
    const downloads: DownloadArtifact[] = [
      {
        kind: 'archive',
        tool: 'node',
        url: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-darwin-arm64.tar.gz',
        official: true,
      },
    ]

    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })

    await expect(
      downloadArtifacts({
        downloads,
        cacheDir,
        fetchImpl,
        retryCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_RETRY_EXHAUSTED' })
  })
})
