# 快照回滚机制与预检增强功能设计文档

**日期**: 2026-03-23
**作者**: Claude
**状态**: 待审查

## 概述

本文档描述了 EnvSetup 项目中快照回滚机制和预检增强功能的设计方案。该方案旨在提供完整的系统状态快照能力，支持智能回滚，并增强预检系统以更准确地预测安装影响。

### 核心目标

1. **快照回滚机制**：记录完整系统状态（文件系统、环境变量、shell 配置文件），支持一键回滚
2. **预检增强**：扩展预检系统，提供详细的影响预览（文件操作、磁盘占用、环境变量变更、时间预估）
3. **智能回滚**：分析失败原因，推荐最优回滚方案，支持用户调整

### 设计原则

- **存储效率**：使用 Git-inspired 内容寻址存储，自动去重
- **功能完整**：覆盖文件系统、环境变量、shell 配置文件的完整状态
- **用户友好**：混合自动/手动快照，智能推荐回滚方案
- **可扩展性**：模块化设计，易于添加新功能

---

## 第一部分：架构概览

### 整体架构

系统分为三个核心模块：

#### 1. 快照管理模块（Snapshot）

**位置**: `src/main/core/snapshot.ts`

**职责**:

- 创建、存储、加载、删除快照
- 管理对象存储（内容寻址）
- 快照数量限制和自动清理
- 垃圾回收：删除快照时减少对象引用计数，引用计数为 0 时删除对象文件

**存储结构**:

```
.envsetup/
├── objects/           # 内容寻址对象存储（按 SHA-256 哈希）
│   ├── ab/
│   │   └── cdef1234...  # 文件内容对象
│   └── ...
├── snapshots/         # 快照索引文件
│   ├── snapshot-uuid-1.json
│   └── snapshot-uuid-2.json
├── snapshot-meta.json # 快照元数据（创建时间、关联任务、标签）
└── objects-refs.json  # 对象引用计数（用于垃圾回收）
```

**文件追踪策略**:

1. 插件声明的安装路径（如 `~/.nvm`、`C:\Program Files\nodejs`）
2. 修改的 shell 配置文件（`~/.bashrc`、`~/.zshrc`、`~/.bash_profile`）
3. 环境变量（通过 `process.env` 读取）
4. 排除规则：
   - 大于 100MB 的单个文件（仅记录路径和哈希，不复制内容）
   - 符号链接（记录链接目标，不追踪目标内容）
   - 临时文件（`.tmp`、`.cache` 等）

#### 2. 预检增强模块（Enhanced Precheck）

**位置**: `src/main/core/enhancedPrecheck.ts`

**职责**:

- 分析插件执行计划
- 生成详细影响报告
- 检测潜在冲突
- 预估安装时间和磁盘占用

**输出内容**:

- 文件系统影响（创建/修改/删除的文件列表、磁盘占用）
- 环境变量影响（新增/修改的变量、PATH 变更）
- 配置文件影响（.bashrc/.zshrc 的具体修改）
- 冲突检测（与现有环境的冲突）
- 时间预估（基于下载大小）

#### 3. 智能回滚模块（Smart Rollback）

**位置**: `src/main/core/rollback.ts`

**职责**:

- 分析失败原因
- 推荐回滚方案
- 执行回滚操作

**策略**:

- 分析失败插件的变更范围
- 计算依赖关系（哪些插件依赖失败的插件）
- 生成回滚建议（最小回滚范围 vs 完全回滚）
- 用户可调整回滚范围

### 数据流

```
任务开始
  ↓
自动创建快照（记录当前系统状态）
  ↓
增强预检（分析执行计划，生成影响报告）
  ↓
用户确认
  ↓
执行任务
  ↓
成功？
  ├─ 是 → 标记快照可删除（保留 N 个最近快照）
  └─ 否 → 智能回滚分析 → 推荐回滚方案 → 用户选择 → 执行回滚
```

---

## 第二部分：数据结构与接口定义

### 快照数据结构

#### 快照索引文件（snapshot-{uuid}.json）

```typescript
type Snapshot = {
  id: string // 快照唯一标识
  taskId: string // 关联的任务 ID
  createdAt: string // 创建时间
  type: 'auto' | 'manual' // 自动创建 or 手动创建
  label?: string // 用户自定义标签

  // 文件系统快照
  files: {
    [filePath: string]: {
      hash: string // 对象存储中的 SHA-256 哈希
      mode: number // 文件权限（如 0o755）
      size: number // 文件大小（字节）
    }
  }

  // 环境变量快照
  environment: {
    variables: Record<string, string> // 环境变量键值对
    path: string[] // PATH 的各个条目
  }

  // Shell 配置文件快照
  shellConfigs: {
    [configPath: string]: {
      hash: string // 配置文件内容的哈希
      lines: number // 行数
    }
  }

  // 元数据
  metadata: {
    platform: 'darwin' | 'win32'
    diskUsage: number // 快照占用磁盘空间（字节）
    fileCount: number // 快照包含的文件数量
  }
}
```

#### 快照元数据文件（snapshot-meta.json）

```typescript
type SnapshotMeta = {
  snapshots: Array<{
    id: string
    taskId: string
    createdAt: string
    type: 'auto' | 'manual'
    label?: string
    canDelete: boolean // 是否可删除（成功任务的快照可删除）
  }>
  maxSnapshots: number // 最大保留数量（默认 5）
}
```

### 增强预检数据结构

#### 执行计划（InstallPlan）

```typescript
type InstallPlan = {
  // 文件系统操作
  fileOperations: Array<{
    type: 'create' | 'modify' | 'delete'
    path: string
    size?: number // 文件大小（字节）
    description: string // 操作描述
  }>

  // 环境变量变更
  envChanges: Array<{
    type: 'add' | 'modify' | 'delete'
    key: string
    value?: string
    scope: 'user' | 'session'
    description: string
  }>

  // Shell 配置文件修改
  shellConfigChanges: Array<{
    file: string // 如 ~/.bashrc
    changes: Array<{
      type: 'append' | 'prepend' | 'replace'
      content: string
      lineNumber?: number // replace 时需要
    }>
  }>

  // 下载计划
  downloads: Array<{
    url: string
    size: number // 字节
    tool: string
    checksumUrl?: string
  }>

  // 命令执行计划
  commands: string[]

  // 预估信息
  estimates: {
    diskUsage: number // 预估磁盘占用（字节）
    downloadSize: number // 预估下载大小（字节）
    duration: number // 预估时间（秒）
  }
}
```

#### 增强预检结果（EnhancedPrecheckResult）

```typescript
type EnhancedPrecheckResult = {
  // 继承原有预检结果
  ...PrecheckResult

  // 新增：执行计划
  plan: InstallPlan

  // 新增：冲突分析
  conflicts: Array<{
    type: 'file_exists' | 'env_conflict' | 'version_mismatch'
    severity: 'error' | 'warning' | 'info'
    message: string
    affectedPath?: string
    suggestion?: string         // 解决建议
  }>

  // 新增：影响摘要
  impactSummary: {
    filesCreated: number
    filesModified: number
    filesDeleted: number
    envVariablesChanged: number
    shellConfigsModified: number
    totalDiskUsage: number
    estimatedDuration: number
  }
}
```

---

### 3. 智能回滚模块（rollback.ts）

#### 核心功能

**分析失败原因（analyzeFailure）**

```typescript
function analyzeFailure(task: InstallTask): FailureAnalysis
```

**实现步骤**：

1. 找到失败的插件（status === 'failed'）
2. 提取失败插件的变更范围：
   - 从 lastResult 中提取 downloads、commands、envChanges
   - 推断受影响的文件路径
3. 分析依赖关系：
   - 检查其他插件是否依赖失败的插件（通过 dependencies 字段）
   - 标记依赖失败插件的其他插件

**生成回滚建议（generateRollbackSuggestion）**

```typescript
async function generateRollbackSuggestion(
  task: InstallTask,
  snapshot: Snapshot,
): Promise<RollbackSuggestion>
```

**实现步骤**：

1. 调用 analyzeFailure 分析失败原因
2. 生成推荐方案：
   - **minimal**：只回滚失败插件的变更
   - **plugin**：回滚失败插件 + 依赖它的插件
   - **full**：完全回滚到快照状态
3. 计算每个方案的影响范围（filesRestored、envVariablesRestored 等）
4. 根据失败严重程度推荐方案：
   - 如果只有一个插件失败且无依赖 → 推荐 minimal
   - 如果有依赖链 → 推荐 plugin
   - 如果多个插件失败 → 推荐 full

**执行回滚（executeRollback）**

```typescript
async function executeRollback(
  suggestion: RollbackSuggestion,
  selectedScope: 'minimal' | 'plugin' | 'full',
  snapshot: Snapshot,
): Promise<void>
```

**实现步骤**：

1. 根据 selectedScope 确定要回滚的插件列表
2. 从快照中提取这些插件相关的文件和环境变量
3. 调用 applySnapshot（partial 模式）恢复
4. 持久化环境变量：
   - macOS: 修改 `~/.zshrc` 或 `~/.bash_profile`，添加 `export KEY=VALUE`
   - Windows: 调用 `setx` 命令或修改注册表 `HKCU\Environment`
   - 验证：重新读取环境变量确认生效
5. 更新任务状态（将回滚的插件标记为 'not_started'）

---

## 技术风险与缓解措施

### 风险 1：权限问题

- **风险**：Windows 修改环境变量需要管理员权限
- **缓解**：检测权限不足时，生成 PowerShell 脚本供用户手动执行

### 风险 2：大文件处理

- **风险**：快照 2GB 安装包导致磁盘空间不足
- **缓解**：大于 100MB 的文件仅记录哈希，不复制内容

### 风险 3：快照格式升级

- **风险**：未来版本无法读取旧快照
- **缓解**：在快照中添加 `version` 字段，实现向后兼容的加载器

### 风险 4：macOS 系统完整性保护（SIP）

- **风险**：SIP 可能阻止某些系统目录的快照
- **缓解**：检测受保护路径，跳过快照并记录警告

### 风险 5：并发任务冲突

- **风险**：用户同时运行多个任务，快照可能相互干扰
- **缓解**：使用任务 ID 隔离快照，每个任务独立管理

### 风险 6：符号链接循环引用

- **风险**：快照符号链接可能导致无限循环
- **缓解**：记录符号链接目标但不追踪目标内容，检测循环引用

---

## 第四部分：错误处理与测试策略

### 错误处理

#### 快照模块错误处理

**1. 对象存储损坏**

- **场景**：对象文件被意外删除或损坏
- **处理**：在 `applySnapshot` 时检查对象完整性，如果缺失则报错并列出缺失的对象
- **恢复**：提示用户无法完全恢复，建议使用其他快照

**2. 快照索引损坏**

- **场景**：快照 JSON 文件格式错误或损坏
- **处理**：在加载时捕获 JSON 解析错误，标记快照为不可用
- **恢复**：从 snapshot-meta.json 中移除该快照

**3. 磁盘空间不足**

- **场景**：创建快照时磁盘空间不足
- **处理**：在创建前检查可用空间（预估需要的空间 × 1.2 作为安全边际）
- **恢复**：提示用户清理磁盘或删除旧快照

**4. 权限问题**

- **场景**：无法写入对象存储目录或无法恢复文件
- **处理**：捕获 EACCES 错误，提示用户检查权限
- **恢复**：建议用户手动修复权限或使用 sudo（仅 macOS）

#### 预检模块错误处理

**1. 插件返回无效计划**

- **场景**：插件的 dry-run 返回格式错误的数据
- **处理**：验证 InstallPlan 结构，缺失字段使用默认值
- **恢复**：记录警告日志，继续执行但标记预检结果不完整

**2. 环境检测失败**

- **场景**：无法读取环境变量或 shell 配置文件
- **处理**：捕获文件读取错误，跳过该检测项
- **恢复**：在预检结果中标记"部分检测失败"

#### 回滚模块错误处理

**1. 回滚过程中断**

- **场景**：回滚执行到一半时出错（如文件写入失败）
- **处理**：记录已恢复的文件列表，保存回滚状态
- **恢复**：提供"继续回滚"选项，从中断点继续

**2. 快照与当前状态冲突**

- **场景**：要恢复的文件已被用户手动修改
- **处理**：检测文件哈希是否与快照记录一致，不一致则警告
- **恢复**：提供选项：强制覆盖 / 跳过该文件 / 取消回滚

---

### 测试策略

#### 单元测试（tests/unit/）

**1. 快照模块测试（snapshot.test.ts）**

- 测试对象存储的创建、读取、去重
- 测试快照索引的生成和加载
- 测试快照数量限制和自动清理
- 测试 SHA-256 哈希计算的正确性

**2. 预检模块测试（enhancedPrecheck.test.ts）**

- 测试执行计划的生成和汇总
- 测试冲突检测逻辑（文件冲突、环境变量冲突）
- 测试影响摘要的计算
- 测试边界情况（空计划、超大计划）

**3. 回滚模块测试（rollback.test.ts）**

- 测试失败分析逻辑
- 测试回滚建议生成（minimal/plugin/full）
- 测试依赖关系分析
- 测试回滚执行的正确性

#### 集成测试（tests/integration/）

**1. 完整流程测试（snapshot-rollback-flow.test.ts）**

- 创建快照 → 执行任务 → 任务失败 → 回滚 → 验证状态恢复
- 测试多次快照和回滚的场景
- 测试快照数量限制的触发

**2. 预检与执行联动测试（precheck-execution.test.ts）**

- 预检生成计划 → 执行任务 → 验证实际变更与计划一致
- 测试冲突检测的准确性

#### E2E 测试（tests/e2e/）

**1. UI 交互测试（snapshot-ui.spec.ts）**

- 测试手动创建快照的 UI 流程
- 测试快照列表的展示
- 测试回滚建议的展示和选择

**2. 真实环境测试（real-install-rollback.spec.ts）**

- 在真实环境中安装 Node.js → 创建快照 → 回滚 → 验证环境恢复
- 仅在 CI 环境中运行（需要隔离环境）

---

### 性能考虑

**1. 对象存储优化**

- 使用流式读写，避免一次性加载大文件到内存
- 对象哈希计算使用 Node.js 原生 crypto 模块（高效）

**2. 快照创建优化**

- 并行计算多个文件的哈希（使用 Promise.all）
- 只快照变更的文件，未变更的文件复用旧快照的对象引用

**3. 预检优化**

- 插件的 dry-run 并行执行（如果插件间无依赖）
- 冲突检测使用缓存，避免重复文件系统检查

**4. 回滚优化**

- 批量恢复文件，减少文件系统操作次数
- 使用流式写入，避免大文件占用内存

---

## 第五部分：UI/UX 集成与实施路线图

### UI/UX 集成

#### 1. 快照管理界面

**位置建议**: `src/renderer/components/SnapshotPanel.tsx`

**界面元素**：

- **快照列表**：显示所有快照（自动/手动、创建时间、关联任务、标签）
- **创建快照按钮**：手动创建快照的入口
- **快照详情**：点击快照展开详情（文件数量、磁盘占用、环境变量数量）
- **删除快照按钮**：删除可删除的快照（成功任务的快照）

#### 2. 增强预检界面

**位置建议**: 增强现有组件 `src/renderer/components/PrecheckResult.tsx`

**界面元素**：

**影响摘要卡片（默认显示）**：

- 文件操作统计（创建/修改/删除数量）
- 磁盘占用预估（带进度条可视化）
- 环境变量变更数量
- 预估安装时间

**详细影响列表（可展开）**：

- 文件操作详情（每个文件的路径和操作类型）
- 环境变量详情（每个变量的键值对）
- Shell 配置文件修改详情（具体修改的行）
- 下载计划（URL、大小、工具）

**冲突警告区域**：

- 高亮显示冲突项
- 提供解决建议（如"清理现有环境"）

#### 3. 智能回滚界面

**位置建议**: `src/renderer/components/RollbackDialog.tsx`

**界面元素**：

**失败分析摘要**：

- 失败的插件名称
- 错误信息
- 受影响的文件和环境变量

**回滚方案选择**：

- 推荐方案（高亮显示，带"推荐"标签）
- 其他方案（可选择）
- 每个方案显示影响范围（文件数、环境变量数）

**自定义回滚（高级选项）**：

- 文件列表（可勾选要恢复的文件）
- 环境变量列表（可勾选要恢复的变量）

**执行回滚按钮**

---

### 与现有系统的集成点

#### 1. 任务执行流程集成

修改 `src/main/ipc/index.ts` 中的 `task:start` 处理器：

```typescript
ipcMain.handle('task:start', async (_event, taskId: string) => {
  const paths = await ensureAppPaths()
  const task = await getTask(taskId, paths.tasksDir)

  // 新增：创建快照
  const snapshot = await createSnapshot({
    taskId: task.id,
    type: 'auto',
    trackedPaths: await inferTrackedPaths(task),
  })

  // 新增：生成增强预检（如果尚未生成）
  if (!task.enhancedPrecheck) {
    const enhancedPrecheck = await generateEnhancedPrecheck(task, BUILTIN_PLUGINS)
    task.enhancedPrecheck = enhancedPrecheck
    await persistTask(task, paths.tasksDir)
  }

  // 执行任务
  const nextTask = await executeTask({
    task,
    registry: BUILTIN_PLUGINS,
    platform: process.platform === 'win32' ? 'win32' : 'darwin',
    tasksDir: paths.tasksDir,
    dryRun: true,
  })

  // 新增：如果任务失败，生成回滚建议
  if (nextTask.status === 'failed' || nextTask.status === 'partially_succeeded') {
    const rollbackSuggestion = await generateRollbackSuggestion(nextTask, snapshot)
    nextTask.rollbackSuggestion = rollbackSuggestion
    await persistTask(nextTask, paths.tasksDir)
  }

  // 新增：如果任务成功，标记快照可删除
  if (nextTask.status === 'succeeded') {
    await markSnapshotDeletable(snapshot.id)
  }

  taskCache.set(nextTask.id, nextTask)
  return nextTask
})
```

#### 2. 预检流程集成

修改 `src/main/ipc/index.ts` 中的 `task:precheck` 处理器：

```typescript
ipcMain.handle('task:precheck', async (_event, payload) => {
  const template = await getTemplate(payload.templateId)

  // 原有预检
  const input = await buildRuntimePrecheckInput(template, payload.values)
  const basicPrecheck = await runPrecheck(input, normalizeLocale(payload.locale))

  // 新增：增强预检
  const tempTask = createTask({
    templateId: template.id,
    templateVersion: template.version,
    locale: normalizeLocale(payload.locale),
    params: payload.values,
    plugins: template.plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      version: plugin.version,
      params: mapTemplateValuesToPluginParams(plugin.pluginId, payload.values),
    })),
  })

  const enhancedPrecheck = await generateEnhancedPrecheck(tempTask, BUILTIN_PLUGINS)

  return {
    ...basicPrecheck,
    ...enhancedPrecheck,
  }
})
```

#### 3. 新增 IPC 通道

在 `src/main/core/contracts.ts` 中扩展 `EnvSetupApi`：

```typescript
export type EnvSetupApi = {
  // ... 现有方法

  // 新增：快照管理
  'snapshot:list': () => Promise<SnapshotMeta>
  'snapshot:create': (payload: { taskId: string; label?: string }) => Promise<Snapshot>
  'snapshot:delete': (snapshotId: string) => Promise<void>
  'snapshot:get': (snapshotId: string) => Promise<Snapshot>

  // 新增：回滚
  'rollback:execute': (payload: {
    taskId: string
    snapshotId: string
    scope: 'minimal' | 'plugin' | 'full'
    pluginIds?: string[]
  }) => Promise<InstallTask>
}
```

---

### 实施路线图

#### 阶段 1：核心基础设施（4-5 天）

- [ ] 实现对象存储模块（SHA-256 哈希、内容寻址、引用计数）
- [ ] 实现快照索引的创建和加载
- [ ] 实现快照元数据管理（数量限制、自动清理、垃圾回收）
- [ ] 实现文件追踪策略（大文件处理、符号链接、排除规则）
- [ ] 单元测试：对象存储、快照创建/加载、垃圾回收

#### 阶段 2：预检增强（2-3 天）

- [ ] 扩展插件接口，支持返回结构化的 InstallPlan
- [ ] 实现执行计划生成和汇总
- [ ] 实现冲突检测逻辑（文件、环境变量、版本）
- [ ] 实现影响摘要计算
- [ ] 处理边界情况（大文件、符号链接、并发任务）
- [ ] 单元测试：计划生成、冲突检测

#### 阶段 3：智能回滚（2-3 天）

- [ ] 实现失败分析逻辑（依赖关系分析）
- [ ] 实现回滚建议生成（minimal/plugin/full）
- [ ] 实现快照应用（全量和部分）
- [ ] 实现环境变量持久化（macOS/Windows）
- [ ] 处理权限问题和 SIP 限制
- [ ] 单元测试：失败分析、回滚建议、快照应用

#### 阶段 4：系统集成（1-2 天）

- [ ] 集成快照到任务执行流程
- [ ] 集成增强预检到预检流程
- [ ] 添加新的 IPC 通道
- [ ] 处理快照版本兼容性
- [ ] 集成测试：完整流程测试

#### 阶段 5：UI 实现（2-3 天）

- [ ] 实现快照管理界面
- [ ] 增强预检结果展示（分级展示）
- [ ] 实现回滚对话框（智能推荐 + 用户调整）
- [ ] E2E 测试：UI 交互测试

#### 阶段 6：优化与文档（1-2 天）

- [ ] 性能优化（并行哈希计算、流式读写）
- [ ] 错误处理完善（中断恢复、冲突处理）
- [ ] 编写用户文档
- [ ] 代码审查和重构

**总计：12-18 天**

---

## 总结

本设计方案提供了一个完整的快照回滚机制和预检增强功能，核心特点包括：

1. **Git-inspired 内容寻址存储**：高效的对象存储，自动去重，节省磁盘空间
2. **完整系统状态快照**：覆盖文件系统、环境变量、shell 配置文件
3. **智能回滚策略**：分析失败原因，推荐最优回滚方案，支持用户调整
4. **详细影响预览**：文件操作、磁盘占用、环境变量变更、时间预估
5. **混合快照模式**：自动创建 + 手动创建，数量限制管理
6. **模块化设计**：三个独立模块（快照、预检、回滚），易于扩展和维护

该方案在功能完整性、存储效率、用户体验之间取得了良好的平衡，预计 12-18 天可完成实施。

### 回滚数据结构（补充完整定义）

#### 失败分析（FailureAnalysis）

```typescript
type FailureAnalysis = {
  failedPlugins: Array<{
    pluginId: string
    error: string
    affectedFiles: string[]
    affectedEnvVars: string[]
  }>
  dependentPlugins: Array<{
    pluginId: string
    dependsOn: string[] // 依赖的失败插件 ID
  }>
}
```

#### 回滚建议（RollbackSuggestion - 完整定义）

```typescript
type RollbackSuggestion = {
  recommended: 'minimal' | 'plugin' | 'full'
  options: {
    minimal: RollbackOption
    plugin: RollbackOption
    full: RollbackOption
  }
  failureAnalysis: FailureAnalysis
}

type RollbackOption = {
  scope: 'minimal' | 'plugin' | 'full'
  pluginsToRollback: string[]
  description: string
  impact: {
    filesRestored: number
    envVariablesRestored: number
    shellConfigsRestored: number
  }
}
```

#### 扩展任务类型（InstallTask）

```typescript
// 在现有 InstallTask 类型基础上扩展
type InstallTask = {
  // ... 现有字段

  // 新增字段
  enhancedPrecheck?: EnhancedPrecheckResult
  rollbackSuggestion?: RollbackSuggestion
  snapshotId?: string // 关联的快照 ID
}
```
