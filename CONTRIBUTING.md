# Contributing

## 提交规则

- 提交信息使用中文，内容简洁明确。
- 提交前检查完整 commit message，不只检查标题。
- 禁止在 commit message 中保留任何 AI 协作者尾注，包括但不限于 `Co-Authored-By: Claude ...`、`Co-Authored-By: Anthropic ...` 或其他模型 / 厂商自动追加的 attribution。
- 除非仓库维护者明确要求，否则 commit author 只保留真实人类维护者。
- 仓库内置了 `.githooks/commit-msg`，会在提交时自动移除常见 AI co-author 尾注；如本地未启用，请执行 `git config core.hooksPath .githooks`。

## 历史重写规则

- 如果需要清理历史中的 AI co-author，只能重写 commit message，不能改动代码内容、文件路径或最终 tree snapshot。
- 执行历史重写前必须先做完整备份。
- force-push 前必须验证重写前后的代码树一致。

## 参考

- 移除 Claude Contributors 的执行计划见 `docs/superpowers/remove-claude-contributors-plan.md`
