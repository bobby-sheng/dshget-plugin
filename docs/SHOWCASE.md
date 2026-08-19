# DSH Get Plugin: search and install DSH plugins inside DeepSeek Harness

DSH Get Plugin brings the public [DSH Get](https://www.dshget.com/) catalog into a running DeepSeek Harness session. It lets users search and inspect plugins, refresh a validated catalog snapshot, and explicitly install a selected catalog entry without leaving DSH.

## What it adds

- `/dshget search <query>` across names, authors, categories, tags, descriptions, and catalog sources.
- `/dshget info <owner/name>` with repository, install command, and canonical DSH Get detail link.
- `/dshget install <owner/name>` for explicit human-triggered installation.
- `/dshget update` and `/dshget status` for the local validated snapshot.
- Read-only `dshget_search` and `dshget_plugin_info` tools for agents.
- An embedded catalog snapshot, so search still works offline.

## Install

```bash
dsh plugin --profile web add -w github:bobby-sheng/dshget-plugin
```

Restart DSH after installation.

Repository: https://github.com/bobby-sheng/dshget-plugin

Catalog: https://www.dshget.com/

Release: https://github.com/bobby-sheng/dshget-plugin/releases/tag/v0.1.1

## Safety boundary

Model tools cannot install software. Installation requires a human slash command, accepts only allowlisted npm/GitHub package forms, and invokes `dsh plugin add` with a fixed argument array rather than a shell. Catalog inclusion is not a security review; users should inspect third-party source before installing it.

## 中文简介

DSH Get Plugin 将公开的 DSH Get 插件目录带入 DeepSeek Harness。用户可以在会话中搜索和查看插件、更新经过校验的目录快照，并通过明确的人工命令安装选中的插件。插件内置离线快照；模型工具保持只读，安装不会由模型自动触发。
