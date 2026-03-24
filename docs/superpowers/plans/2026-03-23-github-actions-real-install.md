# GitHub Actions Real Install E2E CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable GitHub Actions CI to run a full Electron E2E test that actually installs nvm/Node on macOS and Windows runners.

**Architecture:** Minimal code changes — two environment variables (`ENVSETUP_REAL_RUN`, `ENVSETUP_INSTALL_ROOT`) unlock real-run mode and override the install directory. A new Playwright E2E spec drives the full UI flow. A GitHub Actions workflow runs matrix on `macos-latest` + `windows-latest`.

**Tech Stack:** Electron, Playwright (`@playwright/test` electron mode), GitHub Actions, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `src/main/ipc/index.ts` | 2 lines: `dryRun: true` → reads `ENVSETUP_REAL_RUN` env var |
| `src/main/plugins/frontendEnvPlugin.ts` | `toFrontendParams` reads `ENVSETUP_INSTALL_ROOT` to override `installRootDir` |
| `playwright.config.ts` | Add `use: { screenshot: 'only-on-failure', video: 'retain-on-failure' }` |
| `tests/e2e/real-install.spec.ts` | New: full install E2E, skipped unless `ENVSETUP_REAL_RUN=1` |
| `.github/workflows/e2e-real-install.yml` | New: matrix CI workflow |

---

## Task 1: Switch dryRun to read environment variable

**Files:**
- Modify: `src/main/ipc/index.ts:156` and `:203`

- [ ] **Step 1: Open the file and locate the two dryRun lines**

  `src/main/ipc/index.ts` line 156 inside `task:start` handler and line 203 inside `task:retry-plugin` handler both have `dryRun: true`.

- [ ] **Step 2: Replace both occurrences**

  Change:
  ```ts
  dryRun: true,
  ```
  To:
  ```ts
  dryRun: process.env.ENVSETUP_REAL_RUN !== '1',
  ```
  Apply to **both** locations (line ~156 in `task:start` and line ~203 in `task:retry-plugin`).

- [ ] **Step 3: Verify existing tests still pass**

  ```bash
  npm test
  ```
  Expected: all existing unit tests pass. The env var is not set in test env, so `dryRun` remains `true` by default — no behavior change.

- [ ] **Step 4: Commit**

  ```bash
  git add src/main/ipc/index.ts
  git commit -m "feat(ipc): switch dryRun to read ENVSETUP_REAL_RUN env var"
  ```

---

## Task 2: Add ENVSETUP_INSTALL_ROOT override in frontendEnvPlugin

**Files:**
- Modify: `src/main/plugins/frontendEnvPlugin.ts` — `toFrontendParams` function (~line 134)

Context: `installRootDir` is required but set via UI file picker. In CI, Playwright can't click the picker, so the plugin reads an env var override instead.

- [ ] **Step 1: Locate toFrontendParams in frontendEnvPlugin.ts**

  Around line 134–160. The function validates `input.installRootDir` must be non-empty string.

- [ ] **Step 2: Add env var fallback before the validation**

  After the `const locale = input.locale ?? DEFAULT_LOCALE` line and before the `installRootDir` validation, add:

  ```ts
  // Allow CI/test environments to override installRootDir via env var
  const installRootOverride = process.env.ENVSETUP_INSTALL_ROOT
  if (installRootOverride && typeof input.installRootDir !== 'string') {
    ;(input as Record<string, unknown>).installRootDir = installRootOverride
  }
  ```

  Actually, `input` is `PluginExecutionInput` — it's safer to apply the override at resolution time. Instead, add to the returned params object:

  Find the `return {` block at the end of `toFrontendParams` that builds `FrontendPluginParams` and change `installRootDir: input.installRootDir as string` to:

  ```ts
  installRootDir: (typeof input.installRootDir === 'string' && input.installRootDir.length > 0
    ? input.installRootDir
    : process.env.ENVSETUP_INSTALL_ROOT) as string,
  ```

  Read the actual return statement first to get the exact shape before editing.

- [ ] **Step 3: Run existing frontend-plugin unit tests**

  ```bash
  npx vitest run tests/unit/frontend-plugin.test.ts
  ```
  Expected: all pass. The override only activates when `installRootDir` is absent/empty, which doesn't happen in existing tests.

- [ ] **Step 4: Commit**

  ```bash
  git add src/main/plugins/frontendEnvPlugin.ts
  git commit -m "feat(plugin): read ENVSETUP_INSTALL_ROOT as installRootDir fallback for CI"
  ```

---

## Task 3: Update playwright.config.ts for failure artifacts

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add use block with screenshot and video**

  Current content:
  ```ts
  export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    fullyParallel: false,
  })
  ```

  Change to:
  ```ts
  export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    fullyParallel: false,
    use: {
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    },
  })
  ```

- [ ] **Step 2: Verify existing E2E still launches**

  ```bash
  npm run build && npm run test:e2e
  ```
  Expected: existing `app.spec.ts` tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add playwright.config.ts
  git commit -m "test(e2e): enable screenshot and video capture on failure"
  ```

---

## Task 4: Write real-install E2E spec

**Files:**
- Create: `tests/e2e/real-install.spec.ts`

- [ ] **Step 1: Create the spec file**

  ```ts
  import os from 'node:os'
  import { test, expect, _electron as electron } from '@playwright/test'

  const isRealRun = process.env.ENVSETUP_REAL_RUN === '1'

  test.describe('real install', () => {
    test.skip(!isRealRun, 'Only runs when ENVSETUP_REAL_RUN=1')

    test('frontend env installs nvm and node successfully', async () => {
      test.setTimeout(180_000)

      const installRoot = process.env.RUNNER_TEMP ?? os.tmpdir()

      const app = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          ENVSETUP_REAL_RUN: '1',
          ENVSETUP_INSTALL_ROOT: installRoot,
        },
      })

      const page = await app.firstWindow()

      // Select frontend template
      await page.getByRole('button', { name: '前端开发环境' }).click()

      // Select first LTS version from dropdown
      await page.locator('select[id="frontend.nodeVersion"]').selectOption({ index: 0 })

      // Run precheck
      await page.getByRole('button', { name: '运行预检' }).click()
      await expect(page.getByText(/通过|警告|阻塞/)).toBeVisible({ timeout: 30_000 })

      // Create task
      await page.getByRole('button', { name: '创建任务' }).click()
      await expect(page.getByText(/草稿|就绪|执行中/)).toBeVisible({ timeout: 10_000 })

      // Start task
      await page.getByRole('button', { name: '启动任务' }).click()

      // Wait for task to reach terminal state
      await expect(
        page.getByText(/verified_success|succeeded|全部完成/),
      ).toBeVisible({ timeout: 150_000 })

      await app.close()
    })
  })
  ```

- [ ] **Step 2: Verify the test is skipped locally (no ENVSETUP_REAL_RUN set)**

  ```bash
  npm run build && npm run test:e2e
  ```
  Expected: `real-install.spec.ts` shows as skipped, existing tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/real-install.spec.ts
  git commit -m "test(e2e): add real install E2E spec guarded by ENVSETUP_REAL_RUN"
  ```

---

## Task 5: Add GitHub Actions workflow

**Files:**
- Create: `.github/workflows/e2e-real-install.yml`

- [ ] **Step 1: Create the .github/workflows directory if it doesn't exist**

  ```bash
  mkdir -p .github/workflows
  ```

- [ ] **Step 2: Create the workflow file**

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

- [ ] **Step 3: Commit**

  ```bash
  git add .github/workflows/e2e-real-install.yml
  git commit -m "ci: add GitHub Actions E2E real install workflow for macOS and Windows"
  ```

---

## Verification Checklist

- [ ] `npm test` passes (unit tests unaffected)
- [ ] `npm run build && npm run test:e2e` passes locally (real-install spec skipped)
- [ ] GitHub Actions workflow appears in the repo Actions tab after push to master
- [ ] macOS job reaches `succeeded` task status
- [ ] Windows job reaches `succeeded` task status
- [ ] Failing run uploads screenshots/videos as artifacts
