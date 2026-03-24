# GitHub Actions 真实安装 E2E CI 设计

**日期**: 2026-03-23
**状态**: 草稿
**范围**: CI pipeline + 最小代码改动，实现在 macOS/Windows runner 上真实执行 nvm/Node 安装的 E2E 验证

---

## 背景与目标

EnvSetup 目前 UI 侧 `task:start` 硬编码 `dryRun: true`，任务只生成安装计划而不实际执行。真实安装逻辑已完整实现，但缺乏持续集成验证。

**目标**：在 GitHub Actions 的 macOS 和 Windows runner 上，以完整 Electron 应用方式（Playwright E2E）真实执行 nvm/Node 安装，验证端到端流程。

---

## 方案选择

评估了三个方向：

| 方案 | 描述 | 结论 |
|------|------|------|
| A（采用）| Playwright E2E 驱动完整 Electron 应用 + 真实安装 | 覆盖面最广，与用户使用路径一致 |
| B | 只测插件核心逻辑（Vitest，不启动 Electron） | 绕过 IPC/UI，覆盖不足 |
| C | 分层 CI（PR dry-run + 每日 nightly real-run） | 延迟反馈，初期无必要 |

**选择方案 A**。

---

## 设计详情

### 1. 代码改动：环境变量切换 dry-run

**文件**: `src/main/ipc/index.ts`

将两处 `dryRun: true` 改为读取环境变量：

```ts
// task:start handler（约第 156 行）
dryRun: process.env.ENVSETUP_REAL_RUN !== '1',

// task:retry-plugin handler（约第 203 行）
dryRun: process.env.ENVSETUP_REAL_RUN !== '1',
```

**影响范围**：仅 2 行改动，不影响现有 dry-run 默认行为，向后兼容。

---

### 2. 新增 E2E 测试场景

**文件**: `tests/e2e/real-install.spec.ts`

测试流程：
1. `electron.launch({ args: ['.'] })` 启动打包后的应用
2. 点击「前端开发环境」模板
3. 选择第一个 Node LTS 版本
4. 覆盖安装目录为 runner 临时目录（`process.env.RUNNER_TEMP ?? os.tmpdir()`）
5. 点击「运行预检」，等待结果
6. 点击「创建任务」
7. 点击「启动任务」
8. 轮询/等待任务状态变为 `succeeded`
9. 断言插件状态全部为 `verified_success`

**超时设置**：单个测试 timeout = 180,000ms（nvm 从 GitHub 下载约需 1-3 分钟）

**仅在 real-run 模式下运行**：通过 `test.skip(process.env.ENVSETUP_REAL_RUN !== '1', 'Only runs in CI real-install mode')` 保护本地开发不意外执行真实安装。

---

### 3. Playwright 配置调整

**文件**: `playwright.config.ts`

- 将 `timeout` 从 30,000 提升至 180,000（real-run 场景需要）
- 开启 `screenshot: 'only-on-failure'` 和 `video: 'retain-on-failure'`，失败时上传 artifacts

---

### 4. GitHub Actions Workflow

**文件**: `.github/workflows/e2e-real-install.yml`

```yaml
name: E2E Real Install

on:
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  e2e:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build Electron app
        run: npm run build

      - name: Run E2E real install
        env:
          ENVSETUP_REAL_RUN: '1'
        run: npm run test:e2e
        timeout-minutes: 15

      - name: Upload test artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-results-${{ matrix.os }}
          path: test-results/
          retention-days: 7
```

---

### 5. 关键工程细节

| 关注点 | 处理方式 |
|--------|----------|
| 安装目录 | E2E 中用 `RUNNER_TEMP`（CI）或 `os.tmpdir()`（本地）覆盖参数，避免污染系统目录 |
| 超时 | 测试 timeout 设 180s，workflow job 设 15 分钟 |
| 失败产物 | screenshot + video 通过 `upload-artifact` 保存 7 天 |
| 幂等性 | GitHub Actions runner 每次全新环境，无需清理 |
| macOS 额度 | macOS runner 消耗 10x Linux 分钟，推荐仅 push to master 触发，不在每个 PR 跑 |
| Windows 路径 | `RUNNER_TEMP` 在 Windows 为 `D:\a\_temp`，需确保前端插件 installRootDir 覆盖逻辑兼容 Windows 路径分隔符 |
| nvm-windows vs nvm-sh | frontendEnvPlugin 已按 `platform` 分支处理，CI 中 `process.platform` 自动匹配 |

---

## 文件变更清单

```
.github/workflows/e2e-real-install.yml   # 新增
tests/e2e/real-install.spec.ts           # 新增
src/main/ipc/index.ts                    # 修改 2 行
playwright.config.ts                     # 修改 timeout 和 reporter 配置
```

---

## 成功标准

- [ ] macOS runner 上任务状态最终为 `succeeded`，所有插件 `verified_success`
- [ ] Windows runner 上同上
- [ ] 失败时 CI artifacts 包含截图和录像
- [ ] 本地 `npm run test:e2e`（不设 `ENVSETUP_REAL_RUN`）仍走 dry-run，real-install 场景被 skip
- [ ] 现有 dry-run E2E 用例（`app.spec.ts`）在 CI 中继续通过
