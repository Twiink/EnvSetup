# EnvSetup

开发环境一键配置桌面应用，基于 Electron + React 构建。

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
- **智能回滚**: 任务失败时根据故障分析推荐最佳回滚快照，支持全量和部分回滚
- **引用计数 GC**: 删除快照时自动清理无引用的存储对象

### 增强预检

- **影响预估**: 预测文件变更数量、磁盘占用、预计耗时
- **冲突检测**: 在执行前发现文件冲突、环境变量冲突、版本不匹配
- **故障分类**: 将错误归类为 `network / permission / conflict / dependency`，判断是否可重试并给出建议操作

## 功能概览

- 内置 `Frontend / Java / Python` 三套模板（Java / Python 当前为占位预检模板）
- 支持任务取消
- 前端环境插件支持 `node` 直装和 `nvm` 管理器两种方式
- Node 版本通过官方 LTS 列表下拉选择
- 安装根目录、npm cache、npm global prefix 支持文件夹选择器
- 预检阶段检测已安装的 Node / Java / Python 环境，提供一键清理入口
- 前端环境插件基于官方源生成安装计划：
  - `node` 直装使用 `nodejs.org/dist`
  - macOS `nvm` 使用 `nvm-sh/nvm` 官方仓库
  - Windows `nvm` 使用 `coreybutler/nvm-windows` 官方 Release
- 命令级实时进度日志，可展开查看终端输出
- 本地插件 manifest 校验，支持目录和 zip 导入
- 任务状态管理（含失败分类与回滚建议）、日志脱敏、插件级重试

## 项目结构

```
src/
├── main/
│   ├── core/           # 核心逻辑
│   │   ├── task.ts           # 任务状态机
│   │   ├── precheck.ts       # 预检系统
│   │   ├── enhancedPrecheck.ts  # 增强预检（影响预估/冲突检测）
│   │   ├── environment.ts    # 环境检测
│   │   ├── executionMode.ts  # 执行模式解析
│   │   ├── snapshot.ts       # 快照管理
│   │   ├── rollback.ts       # 回滚引擎
│   │   ├── failureAnalysis.ts  # 故障分析
│   │   ├── plugin.ts         # 插件导入与校验
│   │   ├── template.ts       # 模板加载
│   │   ├── contracts.ts      # 类型定义
│   │   └── ...
│   ├── ipc/            # IPC 通信层
│   └── plugins/        # 内置插件
│       └── nodeEnvPlugin.ts
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
fixtures/templates/     # 内置模板定义
tests/
├── unit/               # 单元测试（18 个文件）
├── integration/        # 集成测试（快照-回滚流程）
├── renderer/           # 渲染进程组件测试
└── e2e/                # E2E 测试（含真实安装验证）
```

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
npm test                 # 单元测试 + 集成测试（Vitest）
npm run test:e2e         # E2E 测试（需先构建，Playwright）
```

### 测试覆盖

| 层级         | 说明                                                               |
| ------------ | ------------------------------------------------------------------ |
| 单元测试     | 核心逻辑全覆盖：任务、预检、插件、快照、回滚、故障分析、执行模式等 |
| 集成测试     | 快照-回滚完整流程验证                                              |
| 渲染进程测试 | React 组件交互、国际化切换、任务执行流程                           |
| E2E 测试     | 应用启动、模板选择、预检、任务创建与执行完整路径                   |
| CI 真实安装  | GitHub Actions 在 macOS + Windows 上执行真实安装验证               |

## CI/CD

- **E2E 真实安装**: push 到 `master` 时在 macOS 和 Windows 上运行真实安装测试
- **Release**: 推送 `v*` 标签时自动构建并发布 GitHub Release（macOS + Windows 产物）

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
- 详细规则见 `CONTRIBUTING.md`

## 使用流程

1. 启动应用，选择模板（如 `前端开发环境`）
2. 调整参数：Node 版本、管理器类型、安装目录等
3. 运行预检，查看通过 / 警告 / 阻塞结果及已发现环境
4. 创建任务并启动执行
5. 在任务面板查看命令级实时进度、日志和结果摘要
6. 如执行失败，查看故障分析和回滚建议
