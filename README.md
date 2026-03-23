# EnvSetup

开发环境一键配置

## 项目约定

- 全项目采用 ESM 组织方式
- 代码标识、变量名、模块名统一使用英文
- 界面文案支持 `zh-CN` 与 `en`，默认语言为 `zh-CN`
- 当前阶段只维护简体中文与英文两套文案

## Current MVP

- Electron + React 单页桌面应用
- 内置 `Frontend Env` 模板
- 左侧模板区包含 `Frontend / Java / Python` 模板，其中 `Java / Python` 先作为占位预检模板存在
- 模板参数覆盖、预检、任务创建与启动
- 本地插件 manifest 校验，支持目录和 zip 导入
- 任务状态、日志脱敏、插件级重试基础能力
- 示例前端环境插件：`node | nvm`、Node 版本、用户态安装根目录、npm cache、global prefix
- `Node` 版本在 UI 中通过官方 LTS 列表下拉选择，不再要求手动输入
- 安装根目录、npm cache、npm global prefix 支持直接打开文件夹选择器
- 预检结果会展示已发现环境的路径、来源以及是否支持一键清理
- 前端环境插件会生成基于官方源的安装计划：
  - `node` 直装固定使用 `nodejs.org/dist`
  - macOS `nvm` 固定使用 `nvm-sh/nvm` 官方 GitHub 仓库归档
  - Windows `nvm` 固定使用 `coreybutler/nvm-windows` 官方 GitHub Release
  - `dry-run` 结果中会带出下载 URL，便于后续做 host allowlist 与 checksum 校验

## Current Status

- 模板选择、参数覆盖、预检、任务创建与任务结果展示已打通
- 前端环境插件已经从“示例命令拼接”升级为“官方源安装计划生成”
- 预检阶段已支持发现 `Node / Java / Python` 的现有环境，并对用户态路径提供受控清理入口
- 目前 UI 侧任务启动仍默认走 `dry-run`，真实下载与安装命令已生成，但默认不会直接改动本机环境
- 真实执行阶段下一步建议补充：
  - 官方源白名单拦截
  - 下载后的 SHA-256 / 签名校验
  - 下载缓存与失败重试
  - 真实环境变量落盘与 shell/profile 写入确认

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run test:e2e
```

## MVP Workflow

1. 启动应用并选择 `Frontend Env`
2. 调整允许覆盖的 Node 与 npm 目录参数
3. 运行预检，查看 `pass / warn / block`
4. 创建任务并启动执行
5. 在任务面板查看插件状态、日志、官方源下载计划和结果摘要
