# 配置与模型指南

[中文](CONFIGURATION.md) | [English](CONFIGURATION.en.md)

## 1. 两种运行模式

| 模式 | 评估 | 起名 | Key |
| --- | --- | --- | --- |
| 本地 Magpie（默认） | `http://127.0.0.1:3425/v1` + `jev-latest` | `http://127.0.0.1:3425/v1/chat/completions` + 任意 chat 模型 | 不需要 |
| 直连 TypeSafe + 云端 Namer | `https://api.typesafe.ai/v1` + `jev-latest` | OpenAI-compatible | 需要 |
| 只用生成模型 | `combined` | 同一个模型一次输出评估+标签 | 需要 |
| 只用 Jev | `jev-latest` | 本地兜底短语库 | 不需要 |

本地 Magpie 同时代理 `/v1/systemone` 和 `/v1/chat/completions`，所以评估和起名都可以零 Key。

## 2. 设置字段

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| 评估模式 | Jev 评估 + 生成起名 | `jev` / `combined` |
| Jev URL | `http://127.0.0.1:3425/v1` | 自动追加 `/systemone` |
| Jev 模型 | `jev-latest` | System One 模型 |
| Jev Key | 空 | 本地 Magpie 不需要 |
| 起名 Provider | `openai` | OpenAI-compatible |
| 起名 URL | `http://127.0.0.1:3425/v1/chat/completions` | 本地 Magpie |
| 起名模型 | `auto/glm-5.3-flash` | 任意 chat 模型 |
| 起名 Key | 空 | 本地 Magpie 不需要 |
| 标签语言 | `auto` | `auto/zh/en/ja/ko/es/fr/de/ru` |
| 语气 | `sharp` | `sharp/soft/abstract/chuuni/academic` |
| 温度 | 0.7 | 起名创意度 |
| 停留阈值 | 500ms | 300–2000 |
| 日预算 | 400 | 0 不限 |
| 全员自动 | 开 | 每个有样本的账号自动入队 |

## 3. Magpie 模型

列出：

```bash
curl -s http://127.0.0.1:3425/v1/models | jq -r '.data[].id'
```

评估必须是 System One 模型（`jev-latest`、`jev-preview`）。起名可以是任意 chat 模型。

推荐起名模型：

- `auto/glm-5.3-flash`：便宜、稳定，默认
- `auto/qwen3.8-max`：中文更自然
- `auto/kimi-k3`：长上下文
- `auto/deepseek-v4.1-flash`：更稳，但慢约 3 倍
- `auto/gpt-6-luna` / `auto/gemini-3.8-flash`：风格更活

推理模型会把 reasoning tokens 计入 `max_tokens`；起名上限已设为 1500。

## 4. 多语言

`labelLang` 控制标签、理由、印象笔记的输出语言；样本原文不翻译。

| 语言 | 校验 |
| --- | --- |
| zh | 3–10 个汉字，可夹 ≤2 ASCII |
| en/es/fr/de | 1–3 个词，≤18 字符 |
| ja | 3–12 个字符，可夹拉丁 |
| ko | 2–12 个字符 |
| ru | 1–3 个词（按拉丁规则） |

校验失败不会落标签，`failCount` 增加；两次后冻结自动进化，可手动重评。

## 5. 数据与隐私

存储键：

```text
xcp:settings
xcp:index
xcp:p:<handle>
xcp:usage
xcp:epoch
xcp:stats
```

导出的 JSON 不包含设置、Key、用量、`seenIds`、`shortHits`。导入只接受白名单字段，重置 `hidden/stable/failCount/cooldownUntil`，并把未来时间戳压到当前+7 天。

## 6. 错误码

| 码 | 含义 | 处理 |
| --- | --- | --- |
| `HTTP 451` | TypeSafe 区域限制 | 改用本地 Magpie 或代理 |
| `EMPTY` | 模型返回空 content | 换模型；起名上限 1500 |
| `BAD_JSON` | 输出不是 JSON | 重试；模型不支持 JSON mode 时自动降级一次 |
| `BAD_LABEL` | 标签长度/字符/类别不合规 | 不落标签；可手动重评 |
| `BAD_ENDPOINT` | URL 非法 | 本地只允许 `localhost/127.0.0.1/[::1]` 的 http |
| `TOO_LARGE` | 响应超过 50KB | 拒绝并计失败 |
| `TRUNCATED` | `finish_reason=length` | 计失败 |

## 7. 自动更新

`src/userscript.header` 的 `@updateURL` / `@downloadURL` 指向：

```text
https://raw.githubusercontent.com/JohnWangggg/x-cyber-profiler/main/dist/x-cyber-profiler.user.js
```

发布：

```bash
npm run release -- patch
git add -A && git commit -m "release vX.Y.Z" && git push
```

Tampermonkey 周期性检查 raw；如果 CDN 缓存导致延迟，可在管理面板手动检查更新。
