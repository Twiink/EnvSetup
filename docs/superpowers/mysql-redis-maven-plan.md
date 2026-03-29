# MySQL Redis Maven Plan

## Goal

为 `EnvSetup` 新增 `MySQL / Redis / Maven` 三套一键安装能力，并把 UI、测试矩阵、CI 工作流与项目规则同步到 7 工具版本。

## Scope

- 新增 `mysql-env`、`redis-env`、`maven-env` 插件与对应模板/fixture
- 扩展主进程 contracts、平台路径、下载白名单、网络探测、环境检测与清理逻辑
- 扩展 IPC / preload / renderer bootstrap、文案与模板交互
- 更新 unit / renderer / integration / E2E 测试
- 更新 `README.md`、`AGENTS.md` 与 GitHub Actions workflow

## Design Decisions

1. `MySQL` 与 `Redis` 采用平台包管理器流，参数分别固定为 `mysqlManager=package` 与 `redisManager=package`。
2. macOS 上的 `MySQL / Redis` 通过 `Homebrew` 安装与卸载，Windows 上通过 `Scoop` 安装与卸载。
3. `Maven` 采用 Apache 官方归档直装流，参数固定为 `mavenManager=maven`，保留版本选择。
4. `Maven` 版本列表来自 `archive.apache.org`，安装后统一设置 `MAVEN_HOME`、`M2_HOME` 与 PATH。
5. 本地开发继续严格使用 `dry-run`；真实安装、真实清理与真实回滚只在 GitHub Actions 和打包应用验证中执行。

## Implementation Plan

### 1. Core

- 在 `src/main/core/contracts.ts` 扩展 3 个工具类型、参数类型与 bootstrap 返回结构。
- 在 `src/main/core/platform.ts` 增加 MySQL / Redis / Maven 的安装路径、环境变量变更与 Windows Scoop shim 处理。
- 在 `src/main/core/download.ts`、`src/main/core/networkCheck.ts`、`src/main/core/mavenVersions.ts` 接入 Maven 官方源与 MySQL / Redis 所需网络目标。
- 在 `src/main/core/environment.ts` 补齐 MySQL / Redis / Maven 的检测、清理计划与回滚相关路径。

### 2. Plugin And UI

- 新增 `src/main/plugins/mysqlEnvPlugin.ts`、`src/main/plugins/redisEnvPlugin.ts`、`src/main/plugins/mavenEnvPlugin.ts`。
- 新增 `fixtures/templates/*` 与 `fixtures/plugins/*`，保持与现有 4 工具相同的模板驱动方式。
- 扩展 `src/main/ipc/index.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`src/renderer/copy.ts`，让 bootstrap、表单与文案支持新工具。

### 3. Test Matrix

- 新增 3 个插件单测与 Maven 版本列表单测。
- 更新 copy / IPC / preload / environment / platform / network / download 测试，覆盖新增字段与行为。
- 更新 renderer 与 E2E bootstrap 测试，确保 Maven 版本选择和 3 个新模板可用。
- 更新 `tests/integration/action-real-cycle-matrix.test.ts`，把真实安装矩阵扩展到 7 工具，并继续覆盖三类场景：
  - 无环境安装后回滚
  - 已有环境处理
  - 清理后重装再回滚

## Rule Updates

- `README.md` 需要从 4 工具说明扩展到 7 工具，并明确：
  - `MySQL / Redis` 为包管理器流
  - `Maven` 为 Apache 官方归档直装
  - 完整真实矩阵由 `action-real-cycle-matrix.test.ts` 与 workflow 负责
- `AGENTS.md` 需要把测试覆盖策略扩展到 `MySQL / Redis / Maven`，并补充三者的安装规则。
- `.github/workflows/e2e-real-install.yml` 与 `.github/workflows/release.yml` 需要把 tool matrix 扩到 7 工具，并把缓存 key 绑定到 3 个新插件文件。

## Verification

1. 修复新增文案/类型带来的单测断言差异。
2. 运行针对性 Vitest，覆盖新插件与相关公共模块。
3. 运行 `npm test`，确认 mock 模式完整回归通过。
4. 保持本地不执行真实安装；真实安装矩阵由 CI 和打包应用验证。
