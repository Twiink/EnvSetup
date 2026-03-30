# EnvSetup 测试覆盖矩阵

本文档汇总当前仓库中与安装、清理、回滚相关的测试覆盖范围，便于核对 UI、任务创建、真实安装矩阵和 GitHub Actions 的覆盖情况。

基线来源：

- `tests/renderer/app.test.tsx`
- `tests/unit/ipc.test.ts`
- `tests/unit/*-plugin.test.ts`
- `tests/unit/platform.test.ts`
- `tests/integration/action-full-flow.test.ts`
- `tests/integration/action-rollback-recovery.test.ts`
- `tests/integration/action-real-cycle-matrix.test.ts`
- `tests/integration/action-real-rollback-matrix.test.ts`
- `tests/e2e/real-install.spec.ts`
- `.github/workflows/e2e-real-install.yml`
- `.github/workflows/release.yml`

## 分层覆盖

| 层级               | 覆盖对象                                           | 平台            | 安装方式                          | 已覆盖场景                                                                                           |
| ------------------ | -------------------------------------------------- | --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Renderer UI        | Git / MySQL / Redis / Maven 版本选择器             | 通用            | 直装 + 包管理器                   | 验证版本下拉可见；切换到包管理器后版本字段仍显示；任务表单能保留版本值                               |
| IPC / 任务创建     | Git / MySQL / Redis / Maven                        | 通用            | 直装 + 包管理器                   | 验证创建任务时会把 `gitVersion` / `mysqlVersion` / `redisVersion` / `mavenVersion` 一并写入 payload  |
| 单元测试           | Git / MySQL / Redis / Maven 插件与平台路径         | macOS / Windows | 直装 + Homebrew / Scoop / package | 验证安装命令、回滚命令、PATH / 环境变量、版本化 Homebrew 公式与 Scoop 包名                           |
| Mock 集成全流程    | Node / Java / Python / Git / MySQL / Redis / Maven | 当前运行平台    | 每个工具全部支持方式              | `已有环境 -> 清理 -> 安装成功`，并验证任务、快照、回滚元数据                                         |
| Mock 回滚恢复      | Node / Java / Python / Git / MySQL / Redis / Maven | 当前运行平台    | 每个工具全部支持方式              | `清理或恢复中途失败 -> 走回滚恢复路径`，验证快照建议、恢复结果、任务持久化                           |
| 真实安装矩阵       | Node / Java / Python / Git / MySQL / Redis / Maven | macOS + Windows | 每个平台支持的真实安装方式        | `无现有环境 -> 真实安装 -> 校验 -> 真实回滚`                                                         |
| 真实清理后重装矩阵 | Node / Java / Python / Git / MySQL / Redis / Maven | macOS + Windows | 每个平台支持的真实安装方式        | `已有环境 -> 检测 -> 真实清理 -> 重装成功`                                                           |
| 真实回滚恢复矩阵   | MySQL / Redis / Maven                              | macOS + Windows | 直装 + 包管理器                   | `已有环境 -> 清理 -> 安装 -> 回滚恢复到清理后快照状态`                                               |
| 打包应用 E2E 冒烟  | Node / MySQL / Redis / Maven                       | macOS + Windows | 代表性真实安装方式                | 验证打包后的 Electron 应用能真实安装、创建任务并执行代表性回滚；不是全矩阵，完整矩阵在真实集成测试里 |

## 真实 CI 版本矩阵

| 工具   | macOS 真实版本矩阵      | Windows 真实版本矩阵    |
| ------ | ----------------------- | ----------------------- |
| Node   | `24.13.1`, `22.22.1`    | `24.13.1`, `22.22.1`    |
| Java   | `21.0.6+7`, `17.0.14+7` | `21.0.6+7`, `17.0.14+7` |
| Python | `3.13.4`, `3.12.10`     | `3.13.4`, `3.12.10`     |
| Git    | `2.33.0`, `2.32.0`      | `2.49.1`, `2.48.2`      |
| MySQL  | `8.4.8`, `8.4.7`        | `8.4.8`, `8.4.7`        |
| Redis  | `7.4.7`, `7.4.6`        | `7.4.7`                 |
| Maven  | `3.9.11`, `3.9.10`      | `3.9.11`, `3.9.10`      |

## 工具与场景对应

| 工具   | macOS 支持方式         | Windows 支持方式    | 真实全新安装 | 真实已有环境清理后重装 | 真实回滚恢复 |
| ------ | ---------------------- | ------------------- | ------------ | ---------------------- | ------------ |
| Node   | 直装、nvm              | 直装、nvm           | 是           | 是                     | 否           |
| Java   | 直装 JDK、SDKMAN       | 直装 JDK、SDKMAN    | 是           | 是                     | 否           |
| Python | 直装、Conda            | 直装、Conda         | 是           | 是                     | 否           |
| Git    | 直装、Homebrew         | 直装、Scoop         | 是           | 是                     | 否           |
| MySQL  | 直装、Homebrew package | 直装、Scoop package | 是           | 是                     | 是           |
| Redis  | 直装、Homebrew package | 直装、Scoop package | 是           | 是                     | 是           |
| Maven  | 直装、Homebrew package | 直装、Scoop package | 是           | 是                     | 是           |

## 补充说明

- GitHub Actions 的 `real-install` job 在 `e2e-real-install.yml` 与 `release.yml` 中都按 `os + tool + tool_version` 矩阵运行真实集成测试。
- 打包应用 E2E 不是全量矩阵，只保留代表性 smoke case；完整 manager/tool 覆盖由 `action-real-cycle-matrix.test.ts` 和 `action-real-rollback-matrix.test.ts` 承担。
- Windows 的 Redis 当前只有 `7.4.7` 一档真实版本覆盖，因为上游可用的 Memurai LTS 安装器目前只对应这一版。
- 当前真实回滚恢复矩阵只覆盖 MySQL / Redis / Maven；其他工具已覆盖真实安装回滚和清理后重装，但没有单独的“恢复到清理后快照状态”矩阵文件。
