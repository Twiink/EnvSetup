# 快照回滚机制与预检增强功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的系统状态快照能力、智能回滚机制和增强预检系统

**Architecture:** 三层模块架构 - 快照管理（Git-inspired 内容寻址存储）、预检增强（详细影响分析）、智能回滚（失败分析和推荐）

**Tech Stack:** TypeScript, Node.js crypto, Electron IPC, React

---

## 文件结构规划

### 新增核心模块文件

- `src/main/core/snapshot.ts` - 快照管理模块（对象存储、快照索引、垃圾回收）
- `src/main/core/enhancedPrecheck.ts` - 预检增强模块（执行计划生成、冲突检测）
- `src/main/core/rollback.ts` - 智能回滚模块（失败分析、回滚建议、执行回滚）

### 扩展现有文件

- `src/main/core/contracts.ts` - 添加新类型定义
- `src/main/ipc/index.ts` - 集成快照和回滚到任务流程
- `src/main/core/appPaths.ts` - 添加快照存储路径

### 测试文件

- `tests/unit/snapshot.test.ts` - 快照模块单元测试
- `tests/unit/enhancedPrecheck.test.ts` - 预检增强单元测试
- `tests/unit/rollback.test.ts` - 回滚模块单元测试
- `tests/integration/snapshot-rollback-flow.test.ts` - 集成测试

### UI 组件（后期）

- `src/renderer/components/SnapshotPanel.tsx` - 快照管理界面
- `src/renderer/components/RollbackDialog.tsx` - 回滚对话框

---

## 阶段 1：核心基础设施（对象存储与快照索引）

### Task 1.1: 扩展类型定义

**Files:**

- Modify: `src/main/core/contracts.ts`

- [ ] **Step 1: 添加快照相关类型定义**

在 `contracts.ts` 文件末尾添加：

```typescript
// 快照相关类型
export type Snapshot = {
  id: string
  taskId: string
  createdAt: string
  type: 'auto' | 'manual'
  label?: string
  files: {
    [filePath: string]: {
      hash: string
      mode: number
      size: number
    }
  }
  environment: {
    variables: Record<string, string>
    path: string[]
  }
  shellConfigs: {
    [configPath: string]: {
      hash: string
      lines: number
    }
  }
  metadata: {
    platform: 'darwin' | 'win32'
    diskUsage: number
    fileCount: number
  }
}

export type SnapshotMeta = {
  snapshots: Array<{
    id: string
    taskId: string
    createdAt: string
    type: 'auto' | 'manual'
    label?: string
    canDelete: boolean
  }>
  maxSnapshots: number
}

export type ObjectRefs = {
  [hash: string]: number // hash -> reference count
}
```

- [ ] **Step 2: 提交类型定义**

```bash
git add src/main/core/contracts.ts
git commit -m "feat(snapshot): add snapshot type definitions"
```

---

### Task 1.2: 实现对象存储模块

**Files:**

- Create: `src/main/core/snapshot.ts`
- Test: `tests/unit/snapshot.test.ts`

- [ ] **Step 1: 编写对象存储测试（哈希计算）**

创建 `tests/unit/snapshot.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeFileHash, storeObject, loadObject } from '../../../src/main/core/snapshot'

describe('Snapshot - Object Storage', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'snapshot-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should compute SHA-256 hash correctly', async () => {
    const content = 'test content'
    const hash = await computeFileHash(Buffer.from(content))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should store and load object by hash', async () => {
    const content = Buffer.from('test content')
    const hash = await storeObject(testDir, content)
    const loaded = await loadObject(testDir, hash)
    expect(loaded.toString()).toBe('test content')
  })

  it('should deduplicate identical content', async () => {
    const content = Buffer.from('same content')
    const hash1 = await storeObject(testDir, content)
    const hash2 = await storeObject(testDir, content)
    expect(hash1).toBe(hash2)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test tests/unit/snapshot.test.ts
```

预期：FAIL - 函数未定义

- [ ] **Step 3: 实现对象存储基础功能**

创建 `src/main/core/snapshot.ts`:

```typescript
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function computeFileHash(content: Buffer): Promise<string> {
  return createHash('sha256').update(content).digest('hex')
}

export async function storeObject(objectsDir: string, content: Buffer): Promise<string> {
  const hash = await computeFileHash(content)
  const subDir = join(objectsDir, hash.slice(0, 2))
  const objectPath = join(subDir, hash.slice(2))

  await mkdir(subDir, { recursive: true })
  await writeFile(objectPath, content)

  return hash
}

export async function loadObject(objectsDir: string, hash: string): Promise<Buffer> {
  const objectPath = join(objectsDir, hash.slice(0, 2), hash.slice(2))
  return readFile(objectPath)
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test tests/unit/snapshot.test.ts
```

预期：PASS

- [ ] **Step 5: 提交对象存储实现**

```bash
git add src/main/core/snapshot.ts tests/unit/snapshot.test.ts
git commit -m "feat(snapshot): implement object storage with content addressing"
```

---

### Task 1.3: 实现引用计数管理

**Files:**

- Modify: `src/main/core/snapshot.ts`
- Modify: `tests/unit/snapshot.test.ts`

- [ ] **Step 1: 添加引用计数测试**

在 `tests/unit/snapshot.test.ts` 中添加：

```typescript
import {
  incrementRefCount,
  decrementRefCount,
  loadRefCounts,
} from '../../../src/main/core/snapshot'

describe('Snapshot - Reference Counting', () => {
  it('should increment reference count', async () => {
    const hash = 'abc123'
    await incrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBe(1)
  })

  it('should decrement reference count', async () => {
    const hash = 'abc123'
    await incrementRefCount(testDir, hash)
    await incrementRefCount(testDir, hash)
    await decrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBe(1)
  })

  it('should remove hash when count reaches zero', async () => {
    const hash = 'abc123'
    await incrementRefCount(testDir, hash)
    await decrementRefCount(testDir, hash)
    const refs = await loadRefCounts(testDir)
    expect(refs[hash]).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test tests/unit/snapshot.test.ts -t "Reference Counting"
```

预期：FAIL

- [ ] **Step 3: 实现引用计数功能**

在 `src/main/core/snapshot.ts` 中添加：

```typescript
import type { ObjectRefs } from './contracts'

const REFS_FILE = 'objects-refs.json'

export async function loadRefCounts(baseDir: string): Promise<ObjectRefs> {
  try {
    const content = await readFile(join(baseDir, REFS_FILE), 'utf8')
    return JSON.parse(content) as ObjectRefs
  } catch {
    return {}
  }
}

async function saveRefCounts(baseDir: string, refs: ObjectRefs): Promise<void> {
  await writeFile(join(baseDir, REFS_FILE), JSON.stringify(refs, null, 2))
}

export async function incrementRefCount(baseDir: string, hash: string): Promise<void> {
  const refs = await loadRefCounts(baseDir)
  refs[hash] = (refs[hash] || 0) + 1
  await saveRefCounts(baseDir, refs)
}

export async function decrementRefCount(baseDir: string, hash: string): Promise<void> {
  const refs = await loadRefCounts(baseDir)
  if (refs[hash]) {
    refs[hash]--
    if (refs[hash] === 0) {
      delete refs[hash]
    }
    await saveRefCounts(baseDir, refs)
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test tests/unit/snapshot.test.ts -t "Reference Counting"
```

预期：PASS

- [ ] **Step 5: 提交引用计数实现**

```bash
git add src/main/core/snapshot.ts tests/unit/snapshot.test.ts
git commit -m "feat(snapshot): implement reference counting for garbage collection"
```

---

### Task 1.4: 实现快照索引创建

**Files:**

- Modify: `src/main/core/snapshot.ts`
- Modify: `src/main/core/contracts.ts`
- Modify: `tests/unit/snapshot.test.ts`

- [ ] **Step 1: 添加快照创建测试**

在 `tests/unit/snapshot.test.ts` 中添加：

```typescript
import { createSnapshot, loadSnapshot } from '../../../src/main/core/snapshot'
import { writeFile } from 'node:fs/promises'

describe('Snapshot - Index Creation', () => {
  it('should create snapshot with file tracking', async () => {
    // 创建测试文件
    const testFile = join(testDir, 'test.txt')
    await writeFile(testFile, 'test content')

    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [testFile],
    })

    expect(snapshot.id).toBeDefined()
    expect(snapshot.taskId).toBe('task-123')
    expect(snapshot.files[testFile]).toBeDefined()
    expect(snapshot.files[testFile].hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should capture environment variables', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [],
    })

    expect(snapshot.environment.variables).toBeDefined()
    expect(snapshot.environment.path).toBeInstanceOf(Array)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test tests/unit/snapshot.test.ts -t "Index Creation"
```

预期：FAIL

- [ ] **Step 3: 实现快照创建功能**

在 `src/main/core/snapshot.ts` 中添加：

```typescript
import { randomUUID } from 'node:crypto'
import { stat, readFile as fsReadFile } from 'node:fs/promises'
import { delimiter } from 'node:path'
import type { Snapshot } from './contracts'

export async function createSnapshot(options: {
  baseDir: string
  taskId: string
  type: 'auto' | 'manual'
  label?: string
  trackedPaths: string[]
}): Promise<Snapshot> {
  const objectsDir = join(options.baseDir, 'objects')
  const files: Snapshot['files'] = {}

  // 追踪文件
  for (const filePath of options.trackedPaths) {
    try {
      const content = await fsReadFile(filePath)
      const fileStat = await stat(filePath)
      const hash = await storeObject(objectsDir, content)
      await incrementRefCount(options.baseDir, hash)

      files[filePath] = {
        hash,
        mode: fileStat.mode,
        size: fileStat.size,
      }
    } catch (error) {
      // 跳过无法读取的文件
      continue
    }
  }

  // 捕获环境变量
  const environment = {
    variables: { ...process.env } as Record<string, string>,
    path: (process.env.PATH || '').split(delimiter),
  }

  const snapshot: Snapshot = {
    id: randomUUID(),
    taskId: options.taskId,
    createdAt: new Date().toISOString(),
    type: options.type,
    label: options.label,
    files,
    environment,
    shellConfigs: {},
    metadata: {
      platform: process.platform as 'darwin' | 'win32',
      diskUsage: Object.values(files).reduce((sum, f) => sum + f.size, 0),
      fileCount: Object.keys(files).length,
    },
  }

  // 保存快照索引
  const snapshotsDir = join(options.baseDir, 'snapshots')
  await mkdir(snapshotsDir, { recursive: true })
  await writeFile(
    join(snapshotsDir, `snapshot-${snapshot.id}.json`),
    JSON.stringify(snapshot, null, 2),
  )

  return snapshot
}

export async function loadSnapshot(baseDir: string, snapshotId: string): Promise<Snapshot> {
  const snapshotPath = join(baseDir, 'snapshots', `snapshot-${snapshotId}.json`)
  const content = await fsReadFile(snapshotPath, 'utf8')
  return JSON.parse(content) as Snapshot
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test tests/unit/snapshot.test.ts -t "Index Creation"
```

预期：PASS

- [ ] **Step 5: 提交快照索引实现**

```bash
git add src/main/core/snapshot.ts tests/unit/snapshot.test.ts
git commit -m "feat(snapshot): implement snapshot index creation and loading"
```

---

### Task 1.5: 实现快照元数据管理

**Files:**

- Modify: `src/main/core/snapshot.ts`
- Modify: `tests/unit/snapshot.test.ts`

- [ ] **Step 1: 添加元数据管理测试**

```typescript
import { updateSnapshotMeta, markSnapshotDeletable } from '../../../src/main/core/snapshot'

describe('Snapshot - Metadata Management', () => {
  it('should track snapshots in metadata', async () => {
    const snapshot = await createSnapshot({
      baseDir: testDir,
      taskId: 'task-123',
      type: 'auto',
      trackedPaths: [],
    })

    await updateSnapshotMeta(testDir, snapshot)

    const meta = await loadSnapshotMeta(testDir)
    expect(meta.snapshots).toHaveLength(1)
    expect(meta.snapshots[0].id).toBe(snapshot.id)
  })

  it('should enforce max snapshots limit', async () => {
    // 创建 6 个快照（超过默认限制 5）
    for (let i = 0; i < 6; i++) {
      const snapshot = await createSnapshot({
        baseDir: testDir,
        taskId: `task-${i}`,
        type: 'auto',
        trackedPaths: [],
      })
      await updateSnapshotMeta(testDir, snapshot)
    }

    const meta = await loadSnapshotMeta(testDir)
    expect(meta.snapshots.length).toBeLessThanOrEqual(5)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test tests/unit/snapshot.test.ts -t "Metadata Management"
```

预期：FAIL

- [ ] **Step 3: 实现元数据管理功能**

```typescript
import type { SnapshotMeta } from './contracts'

const META_FILE = 'snapshot-meta.json'
const DEFAULT_MAX_SNAPSHOTS = 5

export async function loadSnapshotMeta(baseDir: string): Promise<SnapshotMeta> {
  try {
    const content = await fsReadFile(join(baseDir, META_FILE), 'utf8')
    return JSON.parse(content) as SnapshotMeta
  } catch {
    return {
      snapshots: [],
      maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
    }
  }
}

async function saveSnapshotMeta(baseDir: string, meta: SnapshotMeta): Promise<void> {
  await writeFile(join(baseDir, META_FILE), JSON.stringify(meta, null, 2))
}

export async function updateSnapshotMeta(baseDir: string, snapshot: Snapshot): Promise<void> {
  const meta = await loadSnapshotMeta(baseDir)

  meta.snapshots.push({
    id: snapshot.id,
    taskId: snapshot.taskId,
    createdAt: snapshot.createdAt,
    type: snapshot.type,
    label: snapshot.label,
    canDelete: false,
  })

  // 清理超过限制的可删除快照
  const deletableSnapshots = meta.snapshots.filter((s) => s.canDelete)
  if (meta.snapshots.length > meta.maxSnapshots && deletableSnapshots.length > 0) {
    const toDelete = deletableSnapshots.slice(0, meta.snapshots.length - meta.maxSnapshots)
    for (const snap of toDelete) {
      await deleteSnapshot(baseDir, snap.id)
    }
    meta.snapshots = meta.snapshots.filter((s) => !toDelete.includes(s))
  }

  await saveSnapshotMeta(baseDir, meta)
}

export async function markSnapshotDeletable(baseDir: string, snapshotId: string): Promise<void> {
  const meta = await loadSnapshotMeta(baseDir)
  const snapshot = meta.snapshots.find((s) => s.id === snapshotId)
  if (snapshot) {
    snapshot.canDelete = true
    await saveSnapshotMeta(baseDir, meta)
  }
}

async function deleteSnapshot(baseDir: string, snapshotId: string): Promise<void> {
  const snapshot = await loadSnapshot(baseDir, snapshotId)

  // 减少对象引用计数
  for (const file of Object.values(snapshot.files)) {
    await decrementRefCount(baseDir, file.hash)
  }

  // 删除快照索引文件
  await rm(join(baseDir, 'snapshots', `snapshot-${snapshotId}.json`))
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test tests/unit/snapshot.test.ts -t "Metadata Management"
```

预期：PASS

- [ ] **Step 5: 提交元数据管理实现**

```bash
git add src/main/core/snapshot.ts tests/unit/snapshot.test.ts
git commit -m "feat(snapshot): implement metadata management with auto-cleanup"
```
