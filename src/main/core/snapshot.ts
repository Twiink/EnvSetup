import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ObjectRefs } from './contracts'

// ============================================================
// 对象存储（内容寻址）
// ============================================================

/**
 * 计算 Buffer 内容的 SHA-256 哈希
 */
export function computeFileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 将内容存储到对象存储中（内容寻址，自动去重）
 * 使用 Git-style 两级目录结构：objects/{hash[0:2]}/{hash[2:]}
 */
export async function storeObject(objectsDir: string, content: Buffer): Promise<string> {
  const hash = computeFileHash(content)
  const subDir = join(objectsDir, hash.slice(0, 2))
  const objectPath = join(subDir, hash.slice(2))

  try {
    await access(objectPath, constants.F_OK)
    return hash
  } catch {
    // file does not exist, proceed to write
  }

  await mkdir(subDir, { recursive: true })
  await writeFile(objectPath, content)

  return hash
}

/**
 * 从对象存储中读取内容
 */
export async function loadObject(objectsDir: string, hash: string): Promise<Buffer> {
  const objectPath = join(objectsDir, hash.slice(0, 2), hash.slice(2))
  return readFile(objectPath)
}

// ============================================================
// 引用计数（用于垃圾回收）
// ============================================================

const REFS_FILE = 'objects-refs.json'

/**
 * 加载对象引用计数表
 */
export async function loadRefCounts(baseDir: string): Promise<ObjectRefs> {
  try {
    const content = await readFile(join(baseDir, REFS_FILE), 'utf8')
    return JSON.parse(content) as ObjectRefs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function saveRefCounts(baseDir: string, refs: ObjectRefs): Promise<void> {
  await writeFile(join(baseDir, REFS_FILE), JSON.stringify(refs, null, 2))
}

/**
 * 增加对象引用计数
 */
export async function incrementRefCount(baseDir: string, hash: string): Promise<void> {
  const refs = await loadRefCounts(baseDir)
  refs[hash] = (refs[hash] ?? 0) + 1
  await saveRefCounts(baseDir, refs)
}

/**
 * 减少对象引用计数，计数为 0 时从引用表中删除
 */
export async function decrementRefCount(baseDir: string, hash: string): Promise<void> {
  const refs = await loadRefCounts(baseDir)
  if (refs[hash] === undefined) {
    return
  }
  refs[hash]--
  if (refs[hash] <= 0) {
    delete refs[hash]
  }
  await saveRefCounts(baseDir, refs)
}
