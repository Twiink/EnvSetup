# EnvSetup MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个基于 Electron + TypeScript 的跨平台桌面应用 MVP，支持模板驱动的本地插件导入、预检、安装任务执行、日志持久化，以及一个可运行的前端环境插件（Node / nvm / nvm-windows）。

**Architecture:** 使用 Electron 主进程负责任务编排、插件导入、预检、状态持久化与执行调度；渲染进程负责模板选择、参数覆盖、任务进度与结果展示；插件通过受控 lifecycle 接口接入，由主进程中的 plugin runner 顺序执行。MVP 只实现受信任本地插件、目录与 zip 导入、插件级重试、用户态安装优先，不做远程插件中心与通用步骤级恢复。

**Tech Stack:** Electron、TypeScript、Vite、React、Node.js、Vitest、Testing Library、Playwright（E2E）、Zod

---

## 预期代码结构

### 核心文件与职责

- `package.json` — 工程脚本、依赖、打包命令
- `tsconfig.json` — TypeScript 配置
- `electron.vite.config.ts` — Electron 构建配置
- `src/main/index.ts` — Electron 主进程入口
- `src/main/ipc/index.ts` — IPC 注册入口
- `src/main/core/appPaths.ts` — 应用数据、任务、插件 staging 目录
- `src/main/core/contracts.ts` — 共享任务 / 插件 / 模板 / 错误类型
- `src/main/core/template.ts` — 模板加载、defaults/overrides/dependsOn/affects 解析
- `src/main/core/plugin.ts` — 插件 manifest 校验、目录/zip 导入、插件索引管理
- `src/main/core/precheck.ts` — 平台、架构、目录、依赖、已有环境冲突等预检项生成与聚合
- `src/main/core/task.ts` — 任务创建、状态迁移、执行、重试、结果聚合
- `src/main/core/platform.ts` — macOS / Windows 生效策略、环境变量与 profile 写入抽象
- `src/main/core/logger.ts` — 结构化日志写入与脱敏
- `src/preload/index.ts` — 受控 API 暴露
- `src/renderer/App.tsx` — 单页主界面，承载模板、预检、任务与结果工作流
- `src/renderer/components/TemplatePanel.tsx` — 模板列表与模板详情
- `src/renderer/components/OverrideForm.tsx` — 参数覆盖表单
- `src/renderer/components/PrecheckPanel.tsx` — 预检结果展示
- `src/renderer/components/TaskPanel.tsx` — 任务进度、日志、结果
- `fixtures/templates/frontend-template.json` — 示例模板
- `fixtures/plugins/frontend-env/manifest.json` — 前端环境插件 manifest
- `fixtures/plugins/frontend-env/index.ts` — 前端环境插件入口
- `tests/unit/contracts.test.ts`
- `tests/unit/template.test.ts`
- `tests/unit/plugin.test.ts`
- `tests/unit/precheck.test.ts`
- `tests/unit/task.test.ts`
- `tests/unit/platform.test.ts`
- `tests/unit/frontend-plugin.test.ts`
- `tests/unit/logger.test.ts`
- `tests/renderer/app.test.tsx`
- `tests/e2e/app.spec.ts`

### 收敛规则

- MVP 阶段优先减少文件碎片，先把核心逻辑收敛在 `template.ts / plugin.ts / precheck.ts / task.ts / platform.ts` 这五个核心模块。
- 只有当某个文件明显超过可维护范围时，才在实现阶段拆分。
- 不在实施计划中默认修改规格文档；若发现规格问题，单独提变更。

---

### Task 1: 初始化 Electron + TypeScript + React MVP 骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Test: `tests/e2e/app.spec.ts`

- [ ] **Step 1: 写失败 E2E，要求应用可启动并显示主界面骨架**

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and shows envsetup shell', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await expect(page.getByText('EnvSetup')).toBeVisible()
  await expect(page.getByText('Templates')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 2: 运行 E2E 验证失败**

Run: `npm run test:e2e -- --grep "app launches and shows envsetup shell"`
Expected: FAIL with missing Electron project files

- [ ] **Step 3: 实现最小 Electron + React 应用骨架**

```tsx
export default function App() {
  return (
    <main>
      <h1>EnvSetup</h1>
      <section>
        <h2>Templates</h2>
      </section>
    </main>
  )
}
```

- [ ] **Step 4: 再跑 E2E 确认通过**

Run: `npm run test:e2e -- --grep "app launches and shows envsetup shell"`
Expected: PASS

- [ ] **Step 5: 提交骨架代码**

```bash
git add package.json tsconfig.json electron.vite.config.ts src/main/index.ts src/preload/index.ts src/renderer/main.tsx src/renderer/App.tsx tests/e2e/app.spec.ts
git commit -m "feat: bootstrap envsetup electron shell"
```

---

### Task 2: 定义核心契约、错误模型与任务状态机

**Files:**
- Create: `src/main/core/contracts.ts`
- Test: `tests/unit/contracts.test.ts`

- [ ] **Step 1: 写失败测试，约束任务状态、插件状态、错误分类**

```ts
import { describe, expect, it } from 'vitest'
import { TASK_STATES, PLUGIN_STATES, ERROR_CODES } from '../../src/main/core/contracts'

describe('contracts', () => {
  it('defines task states from spec', () => {
    expect(TASK_STATES).toEqual([
      'draft',
      'prechecking',
      'ready',
      'running',
      'failed',
      'partially_succeeded',
      'succeeded',
      'cancelled',
    ])
  })

  it('defines plugin states from spec', () => {
    expect(PLUGIN_STATES).toContain('installed_unverified')
    expect(PLUGIN_STATES).toContain('needs_rerun')
  })

  it('defines error codes used by mvp', () => {
    expect(ERROR_CODES).toContain('PLUGIN_PACKAGE_INVALID')
    expect(ERROR_CODES).toContain('USER_CANCELLED')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- tests/unit/contracts.test.ts`
Expected: FAIL with missing contracts module

- [ ] **Step 3: 实现契约类型与枚举**

```ts
export const TASK_STATES = [
  'draft',
  'prechecking',
  'ready',
  'running',
  'failed',
  'partially_succeeded',
  'succeeded',
  'cancelled',
] as const

export const PLUGIN_STATES = [
  'not_started',
  'running',
  'installed_unverified',
  'verified_success',
  'failed',
  'needs_rerun',
] as const
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: 提交契约层**

```bash
git add src/main/core/contracts.ts tests/unit/contracts.test.ts
git commit -m "feat: add core mvp contracts"
```

---

### Task 3: 实现模板解析与参数约束

**Files:**
- Create: `src/main/core/template.ts`
- Create: `fixtures/templates/frontend-template.json`
- Test: `tests/unit/template.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 defaults / overrides / dependsOn / affects / 互斥分支**

```ts
import { describe, expect, it } from 'vitest'
import { loadTemplate, resolveTemplate } from '../../src/main/core/template'

describe('template', () => {
  it('resolves pluginId.parameterKey defaults and overrides', () => {
    const template = resolveTemplate({
      id: 'frontend-template',
      defaults: { 'frontend.nodeManager': 'nvm' },
      overrides: {
        'frontend.nodeManager': { editable: true, enum: ['node', 'nvm'] },
        'frontend.nodeVersion': { editable: true, dependsOn: { field: 'frontend.nodeManager', in: ['nvm', 'node'] } },
      },
    } as any)

    expect(template.fields['frontend.nodeManager'].value).toBe('nvm')
    expect(template.fields['frontend.nodeManager'].enum).toEqual(['node', 'nvm'])
  })

  it('rejects override for undefined field', () => {
    expect(() => resolveTemplate({
      id: 'bad',
      defaults: {},
      overrides: { 'frontend.missing': { editable: true } },
    } as any)).toThrowError()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- tests/unit/template.test.ts`
Expected: FAIL with missing template module

- [ ] **Step 3: 实现模板 loader 与 resolver**

```ts
export function resolveTemplate(template: TemplateManifest) {
  const fields = Object.fromEntries(
    Object.entries(template.overrides).map(([key, meta]) => {
      if (!(key in template.defaults)) throw new Error(`Undefined template field: ${key}`)
      return [key, { key, value: template.defaults[key], ...meta }]
    }),
  )

  return { ...template, fields }
}
```

- [ ] **Step 4: 添加前端模板 fixture，覆盖 node / nvm 分支互斥与 npm 目录字段**

```json
{
  "id": "frontend-template",
  "name": "Frontend Env",
  "version": "0.1.0",
  "platforms": ["darwin", "win32"],
  "description": "Frontend environment template",
  "plugins": [{ "pluginId": "frontend-env", "version": "0.1.0" }],
  "defaults": {
    "frontend.nodeManager": "nvm",
    "frontend.nodeVersion": "20.11.1",
    "frontend.npmCacheDir": "~/.envsetup/npm-cache",
    "frontend.npmGlobalPrefix": "~/.envsetup/npm-global"
  },
  "overrides": {
    "frontend.nodeManager": { "editable": true, "enum": ["node", "nvm"] },
    "frontend.nodeVersion": { "editable": true, "required": true },
    "frontend.npmCacheDir": { "editable": true },
    "frontend.npmGlobalPrefix": { "editable": true }
  },
  "checks": []
}
```

- [ ] **Step 5: 运行测试确认通过并提交**

Run: `npm run test -- tests/unit/template.test.ts`
Expected: PASS

```bash
git add src/main/core/template.ts fixtures/templates/frontend-template.json tests/unit/template.test.ts
git commit -m "feat: add template parsing and frontend template fixture"
```

---

### Task 4: 实现本地插件导入，覆盖目录与 zip 两种形态

**Files:**
- Create: `src/main/core/appPaths.ts`
- Create: `src/main/core/plugin.ts`
- Create: `fixtures/plugins/frontend-env/manifest.json`
- Create: `fixtures/plugins/frontend-env/index.ts`
- Test: `tests/unit/plugin.test.ts`

- [ ] **Step 1: 写失败测试，覆盖目录导入、zip 导入与 manifest 校验失败场景**

```ts
import { describe, expect, it } from 'vitest'
import { validatePluginManifest, normalizeImportedPlugin } from '../../src/main/core/plugin'

describe('plugin import', () => {
  it('accepts a valid plugin manifest', () => {
    expect(() => validatePluginManifest({
      id: 'frontend-env',
      name: 'Frontend Env',
      version: '0.1.0',
      mainAppVersion: '^0.1.0',
      platforms: ['darwin', 'win32'],
      permissions: ['download', 'write_path', 'modify_env'],
      parameters: {},
      dependencies: [],
      entry: 'index.ts'
    })).not.toThrow()
  })

  it('rejects manifest without entry', () => {
    expect(() => validatePluginManifest({ id: 'x' })).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- tests/unit/plugin.test.ts`
Expected: FAIL with missing plugin module

- [ ] **Step 3: 实现 manifest 校验与目录导入**

```ts
export function validatePluginManifest(input: unknown) {
  return pluginManifestSchema.parse(input)
}

export async function importPluginFromDirectory(dir: string) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf-8'))
  return validatePluginManifest(manifest)
}
```

- [ ] **Step 4: 实现 zip 导入到 staging 目录并复用目录导入逻辑**

```ts
export async function importPluginFromZip(zipPath: string, stagingDir: string) {
  const extractedDir = await unzipToTemp(zipPath, stagingDir)
  return importPluginFromDirectory(extractedDir)
}
```

- [ ] **Step 5: 添加前端插件 manifest 并提交**

```json
{
  "id": "frontend-env",
  "name": "Frontend Env",
  "version": "0.1.0",
  "mainAppVersion": "^0.1.0",
  "platforms": ["darwin", "win32"],
  "permissions": ["download", "write_path", "modify_env"],
  "parameters": {
    "nodeManager": { "type": "enum", "values": ["node", "nvm"] },
    "nodeVersion": { "type": "version" },
    "npmCacheDir": { "type": "path" },
    "npmGlobalPrefix": { "type": "path" }
  },
  "dependencies": [],
  "entry": "index.ts"
}
```

Run: `npm run test -- tests/unit/plugin.test.ts`
Expected: PASS

```bash
git add src/main/core/appPaths.ts src/main/core/plugin.ts fixtures/plugins/frontend-env/manifest.json tests/unit/plugin.test.ts
git commit -m "feat: add local plugin directory and zip import"
```

---

### Task 5: 实现真实预检项，而不只是聚合器

**Files:**
- Create: `src/main/core/precheck.ts`
- Test: `tests/unit/precheck.test.ts`

- [ ] **Step 1: 写失败测试，覆盖平台、架构、目录可写、已有环境冲突、版本兼容、依赖缺失**

```ts
import { describe, expect, it } from 'vitest'
import { runPrecheck } from '../../src/main/core/precheck'

describe('precheck', () => {
  it('returns block when install directory is not writable', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: false,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: false,
    } as any)

    expect(result.level).toBe('block')
  })

  it('returns warn when existing environment is detected', async () => {
    const result = await runPrecheck({
      platformSupported: true,
      archSupported: true,
      writable: true,
      dependencySatisfied: true,
      versionCompatible: true,
      existingEnvConflict: true,
    } as any)

    expect(result.level).toBe('warn')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run test -- tests/unit/precheck.test.ts`
Expected: FAIL with missing precheck module

- [ ] **Step 3: 实现预检项生产与聚合**

```ts
export async function runPrecheck(input: PrecheckInput) {
  const items = []
  if (!input.platformSupported) items.push({ code: 'PLATFORM_UNSUPPORTED', level: 'block' })
  if (!input.archSupported) items.push({ code: 'ARCH_UNSUPPORTED', level: 'block' })
  if (!input.writable) items.push({ code: 'PATH_NOT_WRITABLE', level: 'block' })
  if (!input.dependencySatisfied) items.push({ code: 'PLUGIN_DEPENDENCY_MISSING', level: 'block' })
  if (!input.versionCompatible) items.push({ code: 'VERSION_INCOMPATIBLE', level: 'block' })
  if (input.existingEnvConflict) items.push({ code: 'EXISTING_ENV_DETECTED', level: 'warn' })

  const level = items.some((x) => x.level === 'block')
    ? 'block'
    : items.some((x) => x.level === 'warn')
      ? 'warn'
      : 'pass'

  return { level, items }
}
```

- [ ] **Step 4: 补一条网络失败与需要提权的预检测试**

Run: `npm run test -- tests/unit/precheck.test.ts`
Expected: FAIL until tests and implementation cover `NETWORK_UNAVAILABLE` and `ELEVATION_REQUIRED`

- [ ] **Step 5: 修完并提交预检层**

Run: `npm run test -- tests/unit/precheck.test.ts`
Expected: PASS

```bash
git add src/main/core/precheck.ts tests/unit/precheck.test.ts
git commit -m "feat: add real mvp precheck evaluation"
```

---

### Task 6: 实现任务状态流转、持久化、日志脱敏与插件级重试

**Files:**
- Create: `src/main/core/logger.ts`
- Create: `src/main/core/task.ts`
- Test: `tests/unit/task.test.ts`
- Test: `tests/unit/logger.test.ts`

- [ ] **Step 1: 写失败测试，覆盖任务状态机、插件状态、结果模型与重试规则**

```ts
import { describe, expect, it } from 'vitest'
import { createTask, applyPluginResult, shouldRerunPlugin } from '../../src/main/core/task'

describe('task', () => {
  it('creates task with draft status and plugin snapshots', () => {
    const task = createTask({ templateId: 'frontend-template', plugins: [{ pluginId: 'frontend-env', version: '0.1.0' }] } as any)
    expect(task.status).toBe('draft')
    expect(task.plugins[0].status).toBe('not_started')
  })

  it('marks plugin for rerun when parameters changed', () => {
    expect(shouldRerunPlugin({ previous: { params: { a: 1 }, version: '1', context: {} }, next: { params: { a: 2 }, version: '1', context: {} } } as any)).toBe(true)
  })
})
```

- [ ] **Step 2: 写失败测试，覆盖日志脱敏**

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeLog } from '../../src/main/core/logger'

describe('logger', () => {
  it('redacts token-like values', () => {
    const result = sanitizeLog('token=secret-123 password=abc')
    expect(result).not.toContain('secret-123')
    expect(result).not.toContain('password=abc')
  })
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npm run test -- tests/unit/task.test.ts tests/unit/logger.test.ts`
Expected: FAIL with missing task/logger modules

- [ ] **Step 4: 实现任务模型、结果聚合、状态持久化与日志脱敏**

```ts
export function createTask(input: CreateTaskInput) {
  return {
    id: crypto.randomUUID(),
    status: 'draft',
    createdAt: Date.now(),
    plugins: input.plugins.map((plugin) => ({ ...plugin, status: 'not_started', logs: [] })),
  }
}
```

```ts
export function sanitizeLog(line: string) {
  return line
    .replace(/token=[^\s]+/gi, 'token=[REDACTED]')
    .replace(/password=[^\s]+/gi, 'password=[REDACTED]')
}
```

- [ ] **Step 5: 跑测试并提交任务与日志层**

Run: `npm run test -- tests/unit/task.test.ts tests/unit/logger.test.ts`
Expected: PASS

```bash
git add src/main/core/task.ts src/main/core/logger.ts tests/unit/task.test.ts tests/unit/logger.test.ts
git commit -m "feat: add task state machine retry logic and log sanitization"
```

---

### Task 7: 实现平台生效策略与“至少一条真实安装链路”

**Files:**
- Create: `src/main/core/platform.ts`
- Modify: `fixtures/plugins/frontend-env/index.ts`
- Test: `tests/unit/platform.test.ts`
- Test: `tests/unit/frontend-plugin.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 macOS / Windows 生效策略与新终端可用标准**

```ts
import { describe, expect, it } from 'vitest'
import { buildPlatformStrategy } from '../../src/main/core/platform'

describe('platform', () => {
  it('returns zsh/bash strategy for darwin', () => {
    const strategy = buildPlatformStrategy('darwin')
    expect(strategy.shellTargets).toEqual(['zsh', 'bash'])
  })

  it('returns powershell strategy for win32', () => {
    const strategy = buildPlatformStrategy('win32')
    expect(strategy.shellTargets).toEqual(['powershell'])
  })
})
```

- [ ] **Step 2: 写失败测试，约束前端插件真实结果模型，而不是占位返回**

```ts
import { describe, expect, it } from 'vitest'
import frontendPlugin from '../../fixtures/plugins/frontend-env/index'

describe('frontend env plugin', () => {
  it('returns install result with version paths and env changes', async () => {
    const result = await frontendPlugin.install({
      nodeManager: 'nvm',
      nodeVersion: '20.11.1',
      npmCacheDir: '/tmp/npm-cache',
      npmGlobalPrefix: '/tmp/npm-global',
      dryRun: true,
      platform: 'darwin',
    })

    expect(result.status).toBe('installed_unverified')
    expect(result.version).toBe('20.11.1')
    expect(result.paths.npmCacheDir).toBe('/tmp/npm-cache')
    expect(result.envChanges.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npm run test -- tests/unit/platform.test.ts tests/unit/frontend-plugin.test.ts`
Expected: FAIL with missing strategy/plugin implementation

- [ ] **Step 4: 实现平台策略、真实最小安装链路与 dry-run/real-run 边界**

要求：

- 插件必须支持 `nodeManager = node | nvm`
- 在 macOS 上实现 `nvm` 初始化片段与用户级 profile 写入计划
- 在 Windows 上实现 `nvm-windows` / Node 直装的 PATH 生效计划
- `install()` 必须返回结构化结果：`status / version / paths / envChanges / commands`
- `verify()` 必须真正检查版本、目录配置是否可读；测试中允许通过 dry-run stub 验证
- 若当前开发平台只适合先做一条真实链路，则至少保证 **一条真实执行链路 + 另一条 dry-run 可验证链路**，并在提交说明中标注

示例实现骨架：

```ts
const frontendPlugin = {
  async install(input) {
    const commands = buildInstallCommands(input)
    if (input.dryRun) {
      return {
        status: 'installed_unverified',
        version: input.nodeVersion,
        paths: {
          npmCacheDir: input.npmCacheDir,
          npmGlobalPrefix: input.npmGlobalPrefix,
        },
        envChanges: buildEnvChanges(input),
        commands,
      }
    }

    await runCommands(commands)
    return {
      status: 'installed_unverified',
      version: input.nodeVersion,
      paths: {
        npmCacheDir: input.npmCacheDir,
        npmGlobalPrefix: input.npmGlobalPrefix,
      },
      envChanges: buildEnvChanges(input),
      commands,
    }
  },
}
```

- [ ] **Step 5: 跑测试并提交平台与前端插件层**

Run: `npm run test -- tests/unit/platform.test.ts tests/unit/frontend-plugin.test.ts`
Expected: PASS

```bash
git add src/main/core/platform.ts fixtures/plugins/frontend-env/index.ts tests/unit/platform.test.ts tests/unit/frontend-plugin.test.ts
git commit -m "feat: add platform strategy and frontend installer plugin"
```

---

### Task 8: 实现单页 UI + IPC，覆盖模板、预检、任务和结果工作流

**Files:**
- Create: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/TemplatePanel.tsx`
- Create: `src/renderer/components/OverrideForm.tsx`
- Create: `src/renderer/components/PrecheckPanel.tsx`
- Create: `src/renderer/components/TaskPanel.tsx`
- Test: `tests/renderer/app.test.tsx`
- Test: `tests/e2e/app.spec.ts`

- [ ] **Step 1: 写失败渲染测试，覆盖模板选择、override 输入校验、预检结果展示**

```tsx
import { render, screen } from '@testing-library/react'
import App from '../../src/renderer/App'

test('renders template list and precheck panel', () => {
  render(<App />)
  expect(screen.getByText('Templates')).toBeInTheDocument()
  expect(screen.getByText('Precheck')).toBeInTheDocument()
})
```

- [ ] **Step 2: 扩展 E2E，使其覆盖 MVP 工作流而不只是标题**

```ts
test('user can select template and create task', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await page.getByText('Frontend Env').click()
  await page.getByLabel('frontend.nodeVersion').fill('20.11.1')
  await page.getByRole('button', { name: 'Run Precheck' }).click()
  await expect(page.getByText(/pass|warn|block/i)).toBeVisible()
  await page.getByRole('button', { name: 'Create Task' }).click()
  await expect(page.getByText(/draft|running|ready/i)).toBeVisible()
  await app.close()
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npm run test -- tests/renderer/app.test.tsx && npm run test:e2e`
Expected: FAIL with missing workflow UI

- [ ] **Step 4: 实现 preload API、IPC 与单页工作流**

```ts
contextBridge.exposeInMainWorld('envSetup', {
  listTemplates: () => ipcRenderer.invoke('template:list'),
  runPrecheck: (payload) => ipcRenderer.invoke('task:precheck', payload),
  createTask: (payload) => ipcRenderer.invoke('task:create', payload),
  startTask: (taskId) => ipcRenderer.invoke('task:start', taskId),
  retryPlugin: (taskId, pluginId) => ipcRenderer.invoke('task:retry-plugin', { taskId, pluginId }),
  importPluginFromPath: (path) => ipcRenderer.invoke('plugin:import', { path }),
})
```

- [ ] **Step 5: 跑测试并提交 UI 工作流**

Run: `npm run test -- tests/renderer/app.test.tsx && npm run test:e2e`
Expected: PASS

```bash
git add src/main/ipc/index.ts src/preload/index.ts src/renderer/App.tsx src/renderer/components/TemplatePanel.tsx src/renderer/components/OverrideForm.tsx src/renderer/components/PrecheckPanel.tsx src/renderer/components/TaskPanel.tsx tests/renderer/app.test.tsx tests/e2e/app.spec.ts
git commit -m "feat: add single-page template precheck and task workflow"
```

---

### Task 9: 集成验收，验证目录/zip 插件导入、任务执行、结果展示

**Files:**
- Modify: `README.md`
- Test: `tests/unit/*.test.ts`
- Test: `tests/renderer/app.test.tsx`
- Test: `tests/e2e/app.spec.ts`

- [ ] **Step 1: 增加 smoke checklist，直接对齐规格验收标准**

```md
- app launches
- frontend template is visible
- override fields respect editable constraints
- local plugin import works from directory
- local plugin import works from zip
- precheck returns pass/warn/block
- task can be created and started
- task result shows version/path/log summary
- plugin retry is available after failure
```

- [ ] **Step 2: 运行完整测试套件**

Run: `npm run test && npm run test:e2e`
Expected: all tests PASS

- [ ] **Step 3: 手动验证至少一条真实安装链路**

Run: `npm run dev`
Expected:
- 能导入本地前端插件（目录或 zip）
- 能加载前端模板
- 能修改 node manager / version / npm 目录参数
- 能看到预检结果
- 能创建任务并看到日志与结果
- 至少一条平台链路可真实完成安装或真实执行到系统命令层

- [ ] **Step 4: 更新 README 的开发、测试与手动验收说明**

```md
## Development
- npm install
- npm run dev
- npm run test
- npm run test:e2e

## MVP Manual Verification
- import local plugin from directory and zip
- load frontend template
- run precheck
- create task
- inspect result, logs, and retry behavior
```

- [ ] **Step 5: 提交集成与 README 更新**

```bash
git add README.md tests package.json src fixtures
git commit -m "chore: validate envsetup mvp acceptance workflow"
```

---

## 实施顺序说明

1. 先搭工程骨架，确保 Electron 应用能启动。
2. 先固化契约、模板与插件 manifest 约束，再做预检、任务和平台策略。
3. 插件导入必须一开始就覆盖目录与 zip 两条路径，避免后补破坏结构。
4. 预检不是单纯聚合器，必须生成真实预检项。
5. 前端环境插件不能只是占位生命周期，必须至少产出真实结构化安装结果，并落地一条真实最小链路。
6. UI 只做单页工作流，避免空仓库阶段拆过多 route/hook 组件。
7. 不默认修改规格文档；若发现需求变化，单独提出变更。

## 测试策略

- **单元测试**：契约、模板解析、manifest 校验、目录/zip 导入、预检项、任务状态机、恢复规则、日志脱敏、平台策略、前端插件结果模型
- **渲染层测试**：模板展示、override 输入、预检展示、任务状态与结果展示
- **E2E**：应用启动、模板可见、可运行预检、可创建任务
- **手动验证**：本地导入插件、切换 Node / nvm 模式、查看结果页与日志、至少一条真实安装链路

## 风险控制

- 一期不要实现远程插件下载、签名校验强约束、通用步骤级恢复。
- 一期不要在插件入口里直接耦合 UI 或 Electron API。
- 一期前端插件先聚焦 Node / nvm / npm，避免同时引入 pnpm / yarn 复杂度。
- 若当前平台不适合同时真实落地 macOS 与 Windows 两条链路，优先保证一条真实链路 + 另一条 dry-run 可验证链路，并在提交说明中明确。
- 以“新开支持终端后可用”为验收标准，不为当前终端即时生效引入额外复杂度。
