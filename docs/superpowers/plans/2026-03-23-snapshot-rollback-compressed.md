# 快照回滚机制与预检增强功能实施计划（压缩版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现完整的系统状态快照能力、智能回滚机制和增强预检系统

**Architecture:** 三层模块架构 - 快照管理（Git-inspired 内容寻址存储）、预检增强（详细影响分析）、智能回滚（失败分析和推荐）

**Tech Stack:** TypeScript, Node.js crypto, Electron IPC, React

**预计时间:** 12-18 天

---

## 阶段 1：核心基础设施（4-5 天）

### 任务 1.1：类型定义与对象存储

**目标:** 建立快照系统的类型基础和对象存储机制

- [ ] 在 `src/main/core/contracts.ts` 添加 Snapshot、SnapshotMeta、ObjectRefs 类型
- [ ] 创建 `src/main/core/snapshot.ts` 实现对象存储（SHA-256 哈希、内容寻址）
- [ ] 实现引用计数管理（incrementRefCount、decrementRefCount）
- [ ] 单元测试：对象存储、哈希计算、去重、引用计数
- [ ] 提交：`feat(snapshot): implement object storage with reference counting`

**关键文件:**

- `src/main/core/contracts.ts`
- `src/main/core/snapshot.ts`
- `tests/unit/snapshot.test.ts`

---

### 任务 1.2：快照索引与元数据

**目标:** 实现快照创建、加载和元数据管理

- [ ] 实现 createSnapshot（文件追踪、环境变量捕获、shell 配置）
- [ ] 实现 loadSnapshot（从索引文件加载）
- [ ] 实现快照元数据管理（updateSnapshotMeta、markSnapshotDeletable）
- [ ] 实现自动清理机制（超过 maxSnapshots 时删除旧快照）
- [ ] 实现垃圾回收（deleteSnapshot 时清理未引用对象）
- [ ] 单元测试：快照创建、加载、元数据管理、自动清理
- [ ] 提交：`feat(snapshot): implement snapshot index and metadata management`

**关键功能:**

- 文件追踪策略（大文件、符号链接、排除规则）
- 环境变量和 PATH 捕获
- Shell 配置文件快照

---

### 任务 1.3：快照应用与恢复

**目标:** 实现快照恢复功能

- [ ] 实现 applySnapshot（全量恢复和部分恢复）
- [ ] 实现文件恢复（从对象存储读取并写入）
- [ ] 实现环境变量恢复（写入 shell 配置文件）
- [ ] 处理恢复过程中的错误（对象缺失、权限问题）
- [ ] 单元测试：快照应用、部分恢复、错误处理
- [ ] 提交：`feat(snapshot): implement snapshot restore functionality`

**平台差异处理:**

- macOS: 修改 ~/.zshrc 或 ~/.bash_profile
- Windows: 使用 setx 或修改注册表

---

## 阶段 2：预检增强（2-3 天）

### 任务 2.1：执行计划生成

**目标:** 扩展预检系统生成详细的执行计划

- [ ] 在 `src/main/core/contracts.ts` 添加 InstallPlan、EnhancedPrecheckResult 类型
- [ ] 创建 `src/main/core/enhancedPrecheck.ts`
- [ ] 实现 generateInstallPlan（汇总插件的 dry-run 结果）
- [ ] 实现文件操作推断（从 downloads 和 commands 推断）
- [ ] 实现环境变量变更提取（从 envChanges 提取）
- [ ] 实现预估计算（磁盘占用、下载大小、时间）
- [ ] 单元测试：计划生成、汇总逻辑、预估计算
- [ ] 提交：`feat(precheck): implement install plan generation`

**关键文件:**

- `src/main/core/enhancedPrecheck.ts`
- `tests/unit/enhancedPrecheck.test.ts`

---

### 任务 2.2：冲突检测与影响摘要

**目标:** 实现冲突检测和影响摘要生成

- [ ] 实现 detectConflicts（文件冲突、环境变量冲突、版本冲突）
- [ ] 实现 generateImpactSummary（统计文件操作、环境变量变更）
- [ ] 集成到现有预检流程（扩展 runPrecheck）
- [ ] 单元测试：冲突检测、影响摘要、边界情况
- [ ] 提交：`feat(precheck): implement conflict detection and impact summary`

**冲突类型:**

- file_exists: 文件已存在
- env_conflict: 环境变量冲突
- version_mismatch: 版本不匹配

---

## 阶段 3：智能回滚（2-3 天）

### 任务 3.1：失败分析

**目标:** 分析任务失败原因和依赖关系

- [ ] 在 `src/main/core/contracts.ts` 添加 FailureAnalysis、RollbackSuggestion 类型
- [ ] 创建 `src/main/core/rollback.ts`
- [ ] 实现 analyzeFailure（识别失败插件、提取变更范围）
- [ ] 实现依赖关系分析（检查插件依赖）
- [ ] 单元测试：失败分析、依赖关系分析
- [ ] 提交：`feat(rollback): implement failure analysis`

**关键文件:**

- `src/main/core/rollback.ts`
- `tests/unit/rollback.test.ts`

---

### 任务 3.2：回滚建议与执行

**目标:** 生成回滚建议并执行回滚

- [ ] 实现 generateRollbackSuggestion（生成 minimal/plugin/full 三种方案）
- [ ] 实现回滚方案影响计算（filesRestored、envVariablesRestored）
- [ ] 实现 executeRollback（调用 applySnapshot 执行回滚）
- [ ] 实现环境变量持久化（macOS/Windows）
- [ ] 处理权限问题和 SIP 限制
- [ ] 单元测试：回滚建议、回滚执行、权限处理
- [ ] 提交：`feat(rollback): implement rollback suggestion and execution`

**回滚策略:**

- minimal: 只回滚失败插件
- plugin: 回滚失败插件 + 依赖插件
- full: 完全回滚到快照状态

---

## 阶段 4：系统集成（1-2 天）

### 任务 4.1：扩展 IPC 接口

**目标:** 添加快照和回滚相关的 IPC 通道

- [ ] 在 `src/main/core/contracts.ts` 扩展 EnvSetupApi 类型
- [ ] 添加 snapshot:list、snapshot:create、snapshot:delete、snapshot:get
- [ ] 添加 rollback:execute
- [ ] 在 `src/main/ipc/index.ts` 注册 IPC 处理器
- [ ] 提交：`feat(ipc): add snapshot and rollback IPC channels`

---

### 任务 4.2：集成到任务流程

**目标:** 将快照和回滚集成到任务执行流程

- [ ] 修改 `task:start` 处理器：任务开始前创建快照
- [ ] 修改 `task:start` 处理器：任务失败时生成回滚建议
- [ ] 修改 `task:start` 处理器：任务成功时标记快照可删除
- [ ] 修改 `task:precheck` 处理器：集成增强预检
- [ ] 在 `src/main/core/contracts.ts` 扩展 InstallTask 类型（添加 enhancedPrecheck、rollbackSuggestion、snapshotId）
- [ ] 集成测试：完整流程测试（创建快照 → 执行任务 → 失败 → 回滚）
- [ ] 提交：`feat(integration): integrate snapshot and rollback into task flow`

**关键文件:**

- `src/main/ipc/index.ts`
- `tests/integration/snapshot-rollback-flow.test.ts`

---

### 任务 4.3：应用路径管理

**目标:** 添加快照存储路径到应用路径管理

- [ ] 修改 `src/main/core/appPaths.ts` 添加 snapshotsDir
- [ ] 确保快照目录在应用启动时创建
- [ ] 提交：`feat(paths): add snapshot storage paths`

---

## 阶段 5：UI 实现（2-3 天）

### 任务 5.1：快照管理界面

**目标:** 实现快照列表和管理功能

- [ ] 创建 `src/renderer/components/SnapshotPanel.tsx`
- [ ] 实现快照列表展示（自动/手动、创建时间、关联任务）
- [ ] 实现手动创建快照按钮
- [ ] 实现快照详情展开（文件数量、磁盘占用、环境变量数量）
- [ ] 实现删除快照功能
- [ ] 提交：`feat(ui): implement snapshot management panel`

---

### 任务 5.2：增强预检界面

**目标:** 增强预检结果展示

- [ ] 修改 `src/renderer/components/PrecheckResult.tsx`
- [ ] 实现影响摘要卡片（文件操作统计、磁盘占用、环境变量变更、预估时间）
- [ ] 实现详细影响列表（可展开）
- [ ] 实现冲突警告区域（高亮显示、解决建议）
- [ ] 提交：`feat(ui): enhance precheck result display`

---

### 任务 5.3：回滚对话框

**目标:** 实现智能回滚界面

- [ ] 创建 `src/renderer/components/RollbackDialog.tsx`
- [ ] 实现失败分析摘要展示
- [ ] 实现回滚方案选择（推荐方案高亮）
- [ ] 实现自定义回滚选项（文件列表、环境变量列表）
- [ ] 实现执行回滚按钮
- [ ] E2E 测试：UI 交互测试
- [ ] 提交：`feat(ui): implement rollback dialog`

**关键文件:**

- `src/renderer/components/RollbackDialog.tsx`
- `tests/e2e/snapshot-ui.spec.ts`

---

## 阶段 6：优化与文档（1-2 天）

### 任务 6.1：性能优化

**目标:** 优化快照和预检性能

- [ ] 实现并行哈希计算（Promise.all）
- [ ] 实现流式读写（避免大文件占用内存）
- [ ] 实现插件 dry-run 并行执行
- [ ] 实现冲突检测缓存
- [ ] 性能测试：大文件、多文件场景
- [ ] 提交：`perf(snapshot): optimize hash calculation and file operations`

---

### 任务 6.2：错误处理完善

**目标:** 完善错误处理和恢复机制

- [ ] 实现对象存储损坏检测
- [ ] 实现快照索引损坏恢复
- [ ] 实现磁盘空间检查
- [ ] 实现回滚中断恢复
- [ ] 实现快照与当前状态冲突处理
- [ ] 提交：`fix(snapshot): improve error handling and recovery`

---

### 任务 6.3：文档与代码审查

**目标:** 完善文档和代码质量

- [ ] 编写用户文档（如何使用快照和回滚）
- [ ] 更新 CLAUDE.md（新增功能说明）
- [ ] 代码审查和重构
- [ ] 最终集成测试
- [ ] 提交：`docs: add snapshot and rollback user documentation`

---

## 关键里程碑

1. **阶段 1 完成**: 快照系统可以创建、加载、恢复快照
2. **阶段 2 完成**: 预检系统可以生成详细的执行计划和冲突检测
3. **阶段 3 完成**: 回滚系统可以分析失败并生成回滚建议
4. **阶段 4 完成**: 快照和回滚完全集成到任务流程
5. **阶段 5 完成**: UI 完整实现，用户可以通过界面管理快照和回滚
6. **阶段 6 完成**: 性能优化、错误处理完善、文档齐全

---

## 技术风险缓解

- **权限问题**: 检测权限不足时生成脚本供用户手动执行
- **大文件处理**: 大于 100MB 的文件仅记录哈希，不复制内容
- **快照格式升级**: 在快照中添加 version 字段，实现向后兼容
- **macOS SIP**: 检测受保护路径，跳过快照并记录警告
- **并发任务冲突**: 使用任务 ID 隔离快照
- **符号链接循环**: 记录链接目标但不追踪目标内容

---

## 执行建议

**推荐执行方式**: Subagent-Driven Development

- 每个任务派发一个新的子代理
- 任务间进行两阶段审查
- 快速迭代，频繁提交

**替代方式**: Inline Execution

- 在当前会话中批量执行
- 在关键检查点进行审查
