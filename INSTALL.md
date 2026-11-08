# 安装与输入助手

## 要求

- Paseo 0.15.0 网页版，并且宿主带[本地草稿桥补丁](host-bridge/README.md)。官方 0.15.x 没有草稿读写和输入框下方位置，插件不会显示「优化」胶囊。
- 一个 OpenAI 兼容的文字接口，以及对应的密钥文件。

## 安装

```bash
paseo plugin install /绝对路径/paseo-composer-assistant
paseo plugin enable composer-assistant
paseo plugin reload composer-assistant
```

安装后，打开会话时输入框上方应出现「优化」胶囊。

## 配置

设置 → 插件 → 输入助手：

- 接口地址（例如 `https://api.example.com/v1`）；
- 模型名称；
- 密钥文件路径；
- 受保护术语（顿号或逗号分隔）；
- 单次最大字符和超时；
- 自动续写开关（默认关闭）、最少字符和每小时上限；
- 回复后下一句开关（默认关闭）；开启后会把助手最后一条回复发给辅助模型。

密钥文件要求本人所有、普通文件（不跟随符号链接）、权限 600 或更严格：

```bash
printf 'your-key' > ~/.config/paseo-assistant-key
chmod 600 ~/.config/paseo-assistant-key
```

插件只在生成建议时读取该文件；密钥不写入设置、日志或仓库。

## 使用

写文字或选中一段 → 点「优化」→ 查看建议 → 「采纳建议」或「保留原文」。采纳只改草稿，不发送；网页端可以用 ⌘Z 撤回。建议生成中可以点「取消」。

「优化」浮窗里可以直接开关两项自动建议，也可以打开完整设置。开启前请先确认浮窗提示的发送内容和每小时上限；两个开关默认关闭。

## 停用与卸载

```bash
paseo plugin disable composer-assistant
paseo plugin remove composer-assistant
```

## 已知限制

- 手机端和没有补丁的宿主不显示胶囊。
- 自动续写和回复后下一句已实现，默认关闭，两项共用每台机器每小时上限。
- 如果程序在写入计数时异常退出，可能留下 `~/.paseo-composer-assistant/auto-budget.json.lock`；此时自动请求会停止。确认所有使用该插件的 Paseo 进程均已停止后，再检查并移除这个锁文件，随后重启应用。
- 没有真实模型验证前，不能假定某个服务返回的建议一定可用；失败会保留原文。
