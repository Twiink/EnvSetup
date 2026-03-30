# EnvSetup

开发环境一键配置桌面应用，基于 Electron + React 构建。支持 Node.js、Java、Python、Git、MySQL、Redis、Maven 七种开发/构建工具的自动化安装、清理与回滚，覆盖 macOS 和 Windows 双平台。

## 技术栈

- **运行时**: Electron 37 + Node.js 20
- **前端**: React 19 + TypeScript 5
- **构建**: electron-vite (Vite 7)
- **打包**: electron-builder（macOS DMG/ZIP、Windows NSIS/Portable、Linux AppImage/DEB）
- **测试**: Vitest（单元/集成） + Playwright（E2E）
- **模块系统**: 全项目 ESM
- **国际化**: 支持 `zh-CN` 与 `en`，默认中文

## 核心架构

项目采用 **Template → Task → Plugin** 三层架构：

```
模板 (fixtures/templates/*.json)
  └── 定义环境配置需求、参数字段、依赖插件
任务 (src/main/core/task.ts)
  └── 管理执行流程：draft → prechecking → ready → running → succeeded/failed/partially_succeeded
插件 (src/main/plugins/)
  └── 实现具体安装逻辑：install() → verify()
```

### 执行模式

插件支持两种执行模式，由主进程统一解析（`src/main/core/executionMode.ts`）：

| 场景                  | 默认模式     | 说明                                   |
| --------------------- | ------------ | -------------------------------------- |
| `npm run dev`         | **dry-run**  | 生成安装计划但不实际执行，用于开发调试 |
| 打包产物              | **real-run** | 实际执行安装命令                       |
| `ENVSETUP_REAL_RUN=1` | **real-run** | 环境变量强制覆盖，无论 dev 或打包      |
| `ENVSETUP_REAL_RUN=0` | **dry-run**  | 环境变量强制覆盖，无论 dev 或打包      |

### 快照与回滚

- **自动快照**: 任务执行前自动对插件涉及的路径创建快照（SHA-256 内容寻址存储）
- **手动快照**: 用户可在 UI 中手动创建快照
- **智能回滚**: 任务失败时根据故障分析推荐最佳回滚快照（置信度评分），支持全量和部分回滚
- **引用计数 GC**: 删除快照时自动清理无引用的存储对象
- **环境变量还原**: 回滚时精确恢复 `process.env` 到快照状态，包括文件路径、文件内容和环境变量值

### 增强预检

- **影响预估**: 预测文件变更数量、磁盘占用、预计耗时
- **冲突检测**: 在执行前发现文件冲突、环境变量冲突、版本不匹配
- **网络探测**: 针对模板依赖的网络目标（如 nodejs.org、github.com）逐一可达性检测
- **故障分类**: 将错误归类为 `network / permission / conflict / dependency`，判断是否可重试并给出建议操作

## 支持的工具与安装方式

内置 7 套模板，安装流分为两类：

- **官方直装流**: Node.js、Java、Python、Git、MySQL、Redis、Maven
- **管理器流**: Node.js（nvm / nvm-windows）、Java（SDKMAN）、Python（Conda）、Git（Homebrew / Scoop）、MySQL（Homebrew / Scoop）、Redis（Homebrew / Scoop）、Maven（Homebrew / Scoop）
- **版本选择**: Node / Java / Python / Git / MySQL / Redis / Maven 都会根据模板暴露版本选择；其中 Git / MySQL / Redis / Maven 的包管理器流也会按所选版本安装与回滚

### Node.js

|              | macOS                                                                                   | Windows                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **直接安装** | 从 `nodejs.org/dist` 下载 `.tar.gz`，`tar` 解压，`shasum -a 256` 校验                   | 从 `nodejs.org/dist` 下载 `.zip`，`Expand-Archive` 解压，`.NET SHA256` 校验                                                   |
| **管理器**   | **nvm** — 从 GitHub 下载 `nvm v0.40.4` 源码 `.tar.gz` 解压安装，`nvm install` 安装 Node | **nvm-windows** — 从 GitHub 下载 `nvm-noinstall.zip` v1.2.2 解压，写 `settings.txt`，`nvm.exe install` + `mklink /J` junction |

### Java

|              | macOS                                                                                                                                             | Windows                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **直接安装** | 从 `api.adoptium.net` 下载 **Eclipse Temurin** JDK `.tar.gz`，`tar --strip-components=1` 解压，展平 `Contents/Home`                               | 从 `api.adoptium.net` 下载 Temurin JDK `.zip`，`Expand-Archive` 解压，`Move-Item` 到目标路径          |
| **管理器**   | **SDKMAN** — 从 `api.sdkman.io` 下载 CLI v5.22.3 `.zip` 离线搭建（不用 `get.sdkman.io`），JDK 通过 `sdk install java <alias> <localDir>` 本地注册 | **SDKMAN** — 同左，但通过 **Git Bash** 执行；若系统无 `bash.exe` 则先静默安装 Git for Windows v2.47.1 |

### Python

|              | macOS                                                                                                                    | Windows                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **直接安装** | 从 `python.org/ftp` 下载 `.pkg`，`pkgutil --expand` + 内联 Python 脚本解码 pbzx/cpio，提取 `Python.framework` 到用户目录 | 从 `python.org/ftp` 下载 `embed-amd64.zip` + `get-pip.py`，`Expand-Archive` 解压，修改 `._pth` 启用 `import site`，运行 `get-pip.py` |
| **管理器**   | **Conda** — 从 `repo.anaconda.com` 下载 `Miniconda3-latest-MacOSX-{arch}.sh`，`bash -b -p` 静默安装                      | **Conda** — 从 `repo.anaconda.com` 下载 `Miniconda3-latest-Windows-x86_64.exe`，`Start-Process /S` 静默安装                          |

### Git

|              | macOS                                                                                                                                              | Windows                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **直接安装** | 从 `sourceforge.net/git-osx-installer` 下载 `.dmg`，`hdiutil attach` → `pkgutil --expand-full` 解包（跳过 `.Trashes`）                             | 从 GitHub `git-for-windows` 下载 `Git-<version>-64-bit.tar.bz2`（非 exe 安装器），`tar -xjf` 解压                                                |
| **管理器**   | **Homebrew** — 下载官方 `install.sh`，`NONINTERACTIVE=1 bash` 安装 Homebrew，按所选版本执行 `brew version-install git@<version>`；回滚卸载对应公式 | **Scoop** — 下载 `get.scoop.sh` 的 `install.ps1`，shadow `Get-ExecutionPolicy` 后执行，按所选版本安装对应 Scoop 包；回滚用 `scoop uninstall git` |

### MySQL

|              | macOS                                                                                                                                                | Windows                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **直接安装** | 从 `dev.mysql.com/get/Downloads/MySQL-8.4` 下载 `MySQL Community Server` 官方 `.tar.gz` 归档，解压到用户目录并校验 `mysql --version`                 | 从 `dev.mysql.com/get/Downloads/MySQL-8.4` 下载 `MySQL Community Server` 官方 `noinstall` `.zip`，`Expand-Archive` 解压到用户目录并校验 `mysql.exe --version` |
| **管理器**   | **Homebrew** — 下载官方 `install.sh`，`NONINTERACTIVE=1 bash` 安装 Homebrew，按所选版本执行 `brew version-install mysql@<version>`；回滚卸载对应公式 | **Scoop** — 下载 `get.scoop.sh` 的 `install.ps1`，完成 bootstrap 后按所选版本执行 `scoop install mysql@<version>`；回滚用 `scoop uninstall mysql`             |

### Redis

|              | macOS                                                                                                                                                | Windows                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **直接安装** | 从 `download.redis.io/releases` 下载官方源码包 `redis-7.4.7.tar.gz`，解压后执行 `make BUILD_TLS=no MALLOC=libc`，并校验 `redis-server --version`     | 从 Redis 官方合作方 `Memurai` 下载 `Memurai Developer` MSI，静默安装到用户目录并使用 MSI 卸载链路回滚；安装后校验 `Memurai for Redis` 二进制是否存在 |
| **管理器**   | **Homebrew** — 下载官方 `install.sh`，`NONINTERACTIVE=1 bash` 安装 Homebrew，按所选版本执行 `brew version-install redis@<version>`；回滚卸载对应公式 | **Scoop** — 下载 `get.scoop.sh` 的 `install.ps1`，完成 bootstrap 后按所选版本执行 `scoop install redis@<version>`；回滚用 `scoop uninstall redis`    |

### Maven

|              | macOS                                                                                                                                                | Windows                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **直接安装** | 从 `archive.apache.org/dist/maven/maven-3` 下载 `apache-maven-<version>-bin.tar.gz`，解压后设置 `MAVEN_HOME` / `M2_HOME` 并校验 `mvn -version`       | 从 `archive.apache.org/dist/maven/maven-3` 下载 `apache-maven-<version>-bin.zip`，`Expand-Archive` 解压后设置 `MAVEN_HOME` / `M2_HOME` 并校验 `mvn.cmd -version` |
| **管理器**   | **Homebrew** — 下载官方 `install.sh`，`NONINTERACTIVE=1 bash` 安装 Homebrew，按所选版本执行 `brew version-install maven@<version>`；回滚卸载对应公式 | **Scoop** — 下载 `get.scoop.sh` 的 `install.ps1`，完成 bootstrap 后按所选版本执行 `scoop install maven@<version>`；回滚用 `scoop uninstall maven`                |

> **设计原则**: 直装流优先使用官方归档或便携包并落到用户目录；管理器流复用官方 Homebrew / Scoop / SDKMAN / Conda / nvm 生态，并在真实清理时优先调用官方卸载命令。

## 功能概览

- 内置 `Node.js / Java / Python / Git / MySQL / Redis / Maven` 七套模板
- 版本通过官方源动态获取或维护（Node LTS、Java Adoptium、Python、Git、MySQL LTS、Redis LTS、Maven）；Git / MySQL / Redis / Maven 的包管理器流也支持版本选择
- 安装目录支持文件夹选择器自定义
- 预检阶段检测已安装的 Node / Java / Python / Git / MySQL / Redis / Maven 环境，提供一键清理入口
- 清理前自动创建快照，清理失败可一键回滚
- 命令级实时进度日志，可展开查看终端输出
- 本地插件 manifest 校验，支持目录和 zip 导入
- 任务状态管理（含失败分类与回滚建议）、日志脱敏、插件级重试
- 环境变量持久化（macOS 写 shell profile managed block，Windows 用 setx）
- 提权回退机制（macOS osascript，权限错误自动重试）
- 下载安全（域名白名单、checksum 校验、失败重试）

## 项目结构

```
src/
├── main/
│   ├── core/           # 核心逻辑
│   │   ├── task.ts           # 任务状态机
│   │   ├── precheck.ts       # 预检系统
│   │   ├── enhancedPrecheck.ts  # 增强预检（影响预估/冲突检测）
│   │   ├── environment.ts    # 环境检测与清理
│   │   ├── executionMode.ts  # 执行模式解析
│   │   ├── snapshot.ts       # 快照管理（SHA-256 内容寻址 + 引用计数 GC）
│   │   ├── rollback.ts       # 回滚引擎（置信度评分 + 全量/部分回滚）
│   │   ├── failureAnalysis.ts  # 故障分析与分类
│   │   ├── envPersistence.ts # 环境变量持久化
│   │   ├── download.ts       # 下载管理（白名单/校验/重试/缓存）
│   │   ├── elevation.ts      # 提权与回退
│   │   ├── networkCheck.ts   # 网络可达性探测
│   │   ├── platform.ts       # 跨平台策略（路径/命令/shell profile）
│   │   ├── plugin.ts         # 插件导入与校验
│   │   ├── template.ts       # 模板加载与解析
│   │   ├── contracts.ts      # 类型与常量定义
│   │   ├── nodeVersions.ts   # Node LTS 版本列表
│   │   ├── javaVersions.ts   # Java LTS 版本列表
│   │   ├── pythonVersions.ts # Python 版本列表
│   │   ├── gitVersions.ts    # Git 版本列表
│   │   ├── mavenVersions.ts  # Maven 版本列表
│   │   └── ...
│   ├── ipc/            # IPC 通信层
│   └── plugins/        # 内置插件
│       ├── nodeEnvPlugin.ts   # Node.js 安装插件
│       ├── javaEnvPlugin.ts   # Java 安装插件
│       ├── pythonEnvPlugin.ts # Python 安装插件
│       ├── gitEnvPlugin.ts    # Git 安装插件
│       ├── mysqlEnvPlugin.ts  # MySQL 安装插件
│       ├── redisEnvPlugin.ts  # Redis 安装插件
│       └── mavenEnvPlugin.ts  # Maven 安装插件
├── preload/            # Electron preload 桥接
├── renderer/           # React UI
│   ├── App.tsx
│   ├── copy.ts               # 国际化文案
│   └── components/
│       ├── TemplatePanel.tsx    # 模板选择
│       ├── OverrideForm.tsx     # 参数覆盖表单
│       ├── PrecheckPanel.tsx    # 预检面板
│       ├── TaskPanel.tsx        # 任务执行与进度
│       ├── SnapshotPanel.tsx    # 快照管理
│       └── RollbackDialog.tsx   # 回滚对话框
└── shared/             # 主进程/渲染进程共享
fixtures/
├── templates/          # 内置模板定义（node/java/python/git/mysql/redis/maven）
└── plugins/            # 外部插件与内置示例 manifest
```

## 如何开发模板插件

新增一套模板插件，通常要同时落四个位置：

1. 在 `src/main/plugins/` 实现真实插件逻辑。
2. 在 `fixtures/plugins/<plugin-id>/manifest.json` 定义插件参数和权限。
3. 在 `fixtures/plugins/<plugin-id>/index.ts` 暴露插件入口。
4. 在 `fixtures/templates/<template-id>.json` 把模板字段和插件绑定起来。

下面是一个最小示例，演示如何新增一个 `acme-env` 模板插件。

### 1. 插件 manifest

`fixtures/plugins/acme-env/manifest.json`

```json
{
  "id": "acme-env",
  "name": {
    "zh-CN": "Acme 工具环境",
    "en": "Acme Environment"
  },
  "version": "0.1.0",
  "mainAppVersion": "^0.1.0",
  "platforms": ["darwin", "win32"],
  "permissions": ["download", "write_path", "modify_env"],
  "parameters": {
    "acmeVersion": {
      "type": "version",
      "required": true
    },
    "installRootDir": {
      "type": "path",
      "required": true
    }
  },
  "dependencies": [],
  "entry": "index.ts"
}
```

### 2. 插件入口

`fixtures/plugins/acme-env/index.ts`

```ts
export { default } from '../../../src/main/plugins/acmeEnvPlugin'
```

### 3. 模板定义

`fixtures/templates/acme-template.json`

```json
{
  "id": "acme-template",
  "name": {
    "zh-CN": "Acme 环境",
    "en": "Acme Environment"
  },
  "version": "0.1.0",
  "platforms": ["darwin", "win32"],
  "description": {
    "zh-CN": "演示如何把模板字段映射到插件参数。",
    "en": "Shows how template fields map to plugin parameters."
  },
  "plugins": [
    {
      "pluginId": "acme-env",
      "version": "0.1.0"
    }
  ],
  "defaults": {
    "acme.acmeVersion": "1.0.0",
    "acme.installRootDir": "./.envsetup-data/acme"
  },
  "overrides": {
    "acme.acmeVersion": {
      "type": "version",
      "editable": true,
      "required": true,
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "affects": ["acme-env"]
    },
    "acme.installRootDir": {
      "type": "path",
      "editable": true,
      "required": true,
      "affects": ["acme-env"]
    }
  },
  "checks": ["acme"],
  "recommended": false
}
```

### 4. 真实插件实现

`src/main/plugins/acmeEnvPlugin.ts`

```ts
import type { PluginInstallResult, PluginLifecycle, PluginVerifyResult } from '../core/contracts'

const acmeEnvPlugin: PluginLifecycle = {
  async install(input): Promise<PluginInstallResult> {
    const installRootDir = String(input.installRootDir)
    const version = String(input.acmeVersion)

    return {
      status: 'installed_unverified',
      executionMode: input.dryRun ? 'dry_run' : 'real_run',
      version,
      paths: {
        installRootDir,
      },
      envChanges: [
        {
          kind: 'path',
          key: 'PATH',
          value: `${installRootDir}/bin`,
          scope: 'user',
          description: 'Expose Acme binary directory in PATH.',
        },
      ],
      downloads: [],
      commands: input.dryRun
        ? [`echo install acme ${version} to ${installRootDir}`]
        : [`mkdir -p ${installRootDir}/bin`, `touch ${installRootDir}/bin/acme`],
      logs: [`acme version=${version}`],
      summary: `Installed Acme ${version}`,
    }
  },

  async verify(input): Promise<PluginVerifyResult> {
    return {
      status: 'verified_success',
      checks: [`verified ${String(input.installRootDir)}`],
    }
  },
}

export default acmeEnvPlugin
```

### 5. 开发约定

- 模板字段 key 使用 `<prefix>.<field>` 形式，例如 `acme.acmeVersion`。
- `defaults`、`overrides`、插件 `parameters` 三处字段要保持一致。
- 如果版本列表要动态获取，需要在 `src/main/core/` 增加对应的版本源模块，并在 IPC bootstrap 中暴露给渲染层。
- 新插件至少补单元测试；如果改到模板选择、真实安装或回滚链路，需要继续补 renderer / integration / E2E。
- 内置插件推荐继续采用 `fixtures/plugins/<id>/index.ts` 代理到 `src/main/plugins/*.ts` 的方式，避免逻辑分叉。

## 开发

```bash
npm install
npm run dev              # 启动开发模式（默认 dry-run）
npm run build            # 构建生产版本
npm run preview          # 预览构建结果
```

强制切换执行模式：

```bash
ENVSETUP_REAL_RUN=1 npm run dev   # 开发模式下强制真实安装
ENVSETUP_REAL_RUN=0 npm run dev   # 显式 dry-run（与默认行为一致）
```

## 打包

```bash
npm run pack             # 构建 + 打包到目录（调试用）
npm run dist             # 构建 + 生成安装包
```

打包产物默认使用 real-run 模式。

## 测试

```bash
npm test                 # 单元测试 + 集成测试（Vitest，mock 模式）
npm run test:integration:real  # 真实安装矩阵（仅 CI / 打包验证启用）
npm run test:e2e         # E2E 测试（需先构建，Playwright）
```

### 测试体系

项目采用四层测试体系，当前包含 **58 个测试文件 + 1 个共享 setup 文件**：

| 层级             | 文件数 | 说明                                                                                                                                              |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **单元测试**     | 41     | 核心逻辑全覆盖：任务状态机、预检、7 个插件、快照、回滚、故障分析、执行模式、下载安全、环境变量持久化、跨平台策略、版本列表、网络探测、IPC、国际化 |
| **集成测试**     | 8      | 快照-回滚完整流程、环境变量还原、全工具安装/清理/回滚流程，以及 7 工具真实安装、清理后重装、回滚恢复矩阵                                          |
| **渲染进程测试** | 7      | React 组件交互（模板/参数/预检/任务/快照/回滚面板）、全应用流程、国际化切换                                                                       |
| **E2E 测试**     | 2      | Electron 应用启动、模板选择→预检→创建→执行完整路径、dry-run 回滚、打包应用真实安装+回滚烟雾测试                                                   |

### 执行模式隔离

| 环境            | 模式     | 说明                                                        |
| --------------- | -------- | ----------------------------------------------------------- |
| 本地 `npm test` | **模拟** | 不执行真实安装/清理/回滚，安全用于本地开发                  |
| GitHub Actions  | **真实** | `ENVSETUP_REAL_RUN=1`，执行真实下载、安装、清理、回滚       |
| 打包应用验证    | **真实** | `ENVSETUP_PACKAGED_RUN=1`，通过打包后的 Electron 二进制执行 |

### 工具×平台×场景覆盖矩阵

对每个支持的工具流，在 macOS 和 Windows 上覆盖四类核心场景：

| 场景                       | 说明                                                           |
| -------------------------- | -------------------------------------------------------------- |
| **无环境 → 安装 → 回滚**   | 全新安装成功后执行回滚，验证安装目录被移除、环境变量被还原     |
| **已有环境处理**           | 检测已存在的环境并正确处理                                     |
| **清理 → 重装**            | 先清理已有环境（含快照保护），再重新安装，验证完整流程         |
| **清理 → 安装 → 回滚恢复** | 安装前先对清理后的基线做快照，安装后回滚，验证恢复到清理后状态 |

完整覆盖矩阵（✅ = 已纳入真实安装/清理/回滚测试矩阵）：

| 工具    | 安装流                   | macOS | Windows |
| ------- | ------------------------ | ----- | ------- |
| Node.js | 直接安装                 | ✅    | ✅      |
| Node.js | nvm / nvm-windows        | ✅    | ✅      |
| Java    | JDK 直接安装             | ✅    | ✅      |
| Java    | SDKMAN                   | ✅    | ✅      |
| Python  | 直接安装                 | ✅    | ✅      |
| Python  | Conda                    | ✅    | ✅      |
| Git     | 直接安装                 | ✅    | ✅      |
| Git     | Homebrew                 | ✅    | —       |
| Git     | Scoop                    | —     | ✅      |
| MySQL   | MySQL Community 归档直装 | ✅    | ✅      |
| MySQL   | Homebrew                 | ✅    | —       |
| MySQL   | Scoop                    | —     | ✅      |
| Redis   | 官方源码 / Memurai 直装  | ✅    | ✅      |
| Redis   | Homebrew                 | ✅    | —       |
| Redis   | Scoop                    | —     | ✅      |
| Maven   | Apache 官方归档直装      | ✅    | ✅      |
| Maven   | Homebrew                 | ✅    | —       |
| Maven   | Scoop                    | —     | ✅      |

### 清理与回滚验证

- **清理**: 检测安装方式 → 有官方卸载则调用（brew uninstall / scoop uninstall / sdk rm）→ 无则删文件+清环境变量 → 清理前自动创建快照 → 失败可回滚
- **回滚**: SHA-256 校验文件内容一致性 → 恢复目录结构（含嵌套空目录）→ 精确还原 `process.env`（突变恢复、新增 key 移除、PATH 还原）→ 回滚后状态与原始状态完全一致

## CI/CD

GitHub Actions 主要包含两条工作流：

- `e2e-real-install.yml`：push 到 `master` 或 PR 时触发
- `release.yml`：推送 `v*` 标签时执行真实矩阵、打包并发布 Release

| Job              | 平台                     | 说明                                                                         |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------- |
| **unit**         | macOS + Windows          | 运行全部单元和集成测试（mock 模式）                                          |
| **real-install** | macOS + Windows × 7 工具 | 真实安装、清理后重装、回滚恢复矩阵（`ENVSETUP_REAL_RUN=1`），含下载/解包缓存 |
| **e2e**          | macOS + Windows          | 打包应用后通过 Playwright 执行代表性真实安装+回滚烟雾测试                    |

## 代码质量

```bash
npm run lint             # ESLint 检查
npm run lint:fix         # 自动修复
npm run format           # Prettier 格式化
npm run format:check     # 格式检查
```

## 提交约束

- 提交信息使用中文，并在提交前检查完整 commit message
- 禁止保留 `Co-Authored-By: Claude ...`、`Co-Authored-By: Anthropic ...` 或其他 AI 自动追加的协作者尾注
- 仓库提供 `.githooks/commit-msg` 自动清理这类尾注；当前仓库可用 `git config core.hooksPath .githooks` 启用
- 详细规则见 `CONTRIBUTING.md`

## 使用流程

1. 启动应用，选择模板（Node.js / Java / Python / Git / MySQL / Redis / Maven）
2. 调整参数：版本、管理器类型（直接安装/管理器安装）、安装目录等
3. 运行预检，查看通过 / 警告 / 阻塞结果、已发现环境及网络可达性
4. 创建任务并启动执行
5. 在任务面板查看命令级实时进度、日志和结果摘要
6. 如需清理已有环境，可一键清理（自动创建快照保护）
7. 如执行失败，查看故障分析和回滚建议，一键回滚到任意快照点
