# Remove Claude Contributors Plan

## Goal

从 GitHub 仓库的 Contributors 中移除 `Claude`，同时保证仓库代码内容、文件路径、分支最终快照保持不变。允许变化的只有 commit SHA 和 commit message 中的 AI co-author 尾注。

## Current State

- 远端仓库：`git@github.com:Twiink/EnvSetup.git`
- 默认分支：`master`
- 当前检测到包含 `Co-Authored-By: Claude ...` 的提交数：`36`
- 当前工作区状态：干净，适合先做备份再重写历史

## Non-Goals

- 不修改任何业务代码
- 不修改任何文件内容
- 不调整目录结构
- 不改动最终分支的 tree snapshot

## Safety Rules

1. 在历史重写开始前冻结 `master`，避免新的提交落在旧历史上。
2. 先做本地分支备份、tag 备份和 bundle 备份，再执行重写。
3. 只移除 AI co-author trailer，不改作者、提交时间、文件树。
4. 重写完成后必须验证 “重写前 HEAD tree == 重写后 HEAD tree”。
5. 推送时只能使用 `git push --force-with-lease`，不能直接 `--force`。
6. 如果校验失败，立即回退到备份分支或 bundle。

## Execution Plan

### 1. Freeze and Backup

先停止新的提交和推送，然后创建三层备份：

```bash
git status --short
git branch backup/pre-remove-claude
git tag backup/pre-remove-claude-2026-03-26
git bundle create /tmp/envsetup-pre-remove-claude.bundle --all
```

记录当前分支快照与目标提交列表：

```bash
git rev-parse master
git rev-parse master^{tree}
git log --all --grep='Co-Authored-By: Claude' --format='%H %s'
```

### 2. Rewrite Only Commit Messages

本仓库已安装 `git filter-repo`，优先使用它，只删除 AI co-author trailer。

执行前再次确认工作区为空，然后运行：

```bash
git filter-repo --force --message-callback '
import re
message = re.sub(
    br"(?mi)^Co-Authored-By:\\s*(Claude|Anthropic)[^\\n]*\\n?",
    b"",
    message,
)
message = re.sub(br"\\n{3,}", b"\\n\\n", message)
return message.rstrip(b"\\n") + b"\\n"
'
```

这一步只重写 commit message，不会改文件树内容。

### 3. Verify Code Integrity

重写后必须验证代码快照完全一致：

```bash
git rev-parse master^{tree}
git rev-parse backup/pre-remove-claude^{tree}
git diff --stat backup/pre-remove-claude master
git fsck --full
git log --all --grep='Co-Authored-By: Claude' --format='%H'
```

验收标准：

- `master^{tree}` 与 `backup/pre-remove-claude^{tree}` 完全一致
- `git diff --stat backup/pre-remove-claude master` 无输出
- `git fsck --full` 无损坏
- `git log --grep='Co-Authored-By: Claude'` 结果为空

### 4. Push Rewritten History

确认校验通过后，再推送到 GitHub：

```bash
git push --force-with-lease origin master
```

说明：

- 默认只需要 force-push `master`
- 备份只保留在本地分支、local tag 和 bundle 中，不把旧历史再次推到远端

### 5. Confirm GitHub Refresh

GitHub Contributors 不会立刻刷新。推送后需要：

```bash
git log --all --grep='Co-Authored-By: Claude' --format='%H'
```

然后等待 GitHub 重新索引 Contributors 页面。仓库页面、提交搜索和贡献者图可能存在缓存延迟。

### 6. Rollback Plan

如果重写后发现异常，使用备份恢复：

```bash
git reset --hard backup/pre-remove-claude
git push --force-with-lease origin master
```

如果本地历史也被破坏，使用 bundle 恢复：

```bash
git clone /tmp/envsetup-pre-remove-claude.bundle /tmp/envsetup-restore
```

## Prevention Plan

为避免 `Claude` 再次出现在 Contributors 中，后续提交必须执行以下约束：

1. 提交前检查完整 commit message，删除所有 AI co-author trailer。
2. 不接受 `Co-Authored-By: Claude ...`、`Co-Authored-By: Anthropic ...`、模型名或厂商名的自动追加尾注。
3. 仅保留真实人类维护者作为 commit author，除非用户明确要求记录其他人类协作者。
4. 如果某个 AI 工具默认追加 co-author 尾注，提交前必须手动删除。
5. 新规则已写入版本化文档 `CONTRIBUTING.md` 与 `README.md`，并同步写入本地代理规则 `AGENTS.md` 与 `CLAUDE.md`。

## Suggested Execution Order

1. 先合并当前文档与规则变更。
2. 选择一个无人提交的新时间窗口冻结 `master`。
3. 按上面的备份、重写、校验、推送顺序执行。
4. 等待 GitHub 刷新 Contributors。
