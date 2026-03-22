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
- 模板参数覆盖、预检、任务创建与启动
- 本地插件 manifest 校验，支持目录和 zip 导入
- 任务状态、日志脱敏、插件级重试基础能力
- 示例前端环境插件：`node | nvm`、Node 版本、npm cache、global prefix

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
5. 在任务面板查看插件状态、日志和结果摘要
