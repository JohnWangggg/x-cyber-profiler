# 性能与存储基准

[中文](PERFORMANCE.md) | [English](PERFORMANCE.en.md)

环境：macOS arm64、Node 26、本地 Magpie `127.0.0.1:3425`、Jev `1.14.0`。  
复现：

```bash
node tools/bench.mjs
node tools/storage-bench.mjs 300
node tools/storage-bench.mjs 900
```

## 1. 生成速度

固定两段样本、英文标签、`tone=sharp`、`max_tokens=1500`：

| 阶段 | 模型 | 延迟 | 输出 tokens | 结果 |
| --- | --- | ---: | ---: | --- |
| Jev System One | `jev-latest` | **493ms** | 403 | 22 个问题全部返回 |
| 起名 | `auto/glm-5.3-flash` | **1.9–2.9s** | 62–72 | `TG Funnel Bot` / `Telegram Shill` |
| 起名 | `auto/kimi-k3` | 3.8s | 62 | `Gem Shiller` |
| 起名 | `auto/deepseek-v4.1-flash` | 6.0s | 489 | `Gem Link Pusher` |
| 起名 | `auto/gpt-6-luna` | 6.6s | 333 | `100x Link Pusher` |
| 起名 | `auto/qwen3.8-max` | 29.3s | 1041 | `Pinned 100x Shill`（异常慢） |

结论：

- **Jev 不是瓶颈**，22 个问题不到 0.5s。
- 起名是主要延迟；GLM Flash 比 DeepSeek Flash 快约 **2–3 倍**，标签质量仍可用。
- 默认已改为 `auto/glm-5.3-flash`；想更稳可用 DeepSeek，想更活可用 Kimi/GPT。
- 首条标签的**最终**结果约 **2.5–3.5s**（Jev + GLM + 500ms 停留）。
- 1.0.4 起，Jev 评估完成后会先挂**临时标签**（本地组合器，约 0.8–1.2s），起名返回后平滑替换；起名失败时临时标签保留为兜底。
- 缓存命中是 **0 网络请求**；扫描时还会预渲染当前/下一屏的缓存标签。

### 还可以加速的点

1. **降低 reasoning 开销**：GLM Flash 基本不花 reasoning；DeepSeek/Qwen 会花大量 reasoning tokens。
2. **模型分级**：首标用 GLM，稳定态精修再用 DeepSeek/Kimi。
3. **缓存评估**：改名门控已避免评估不变时重复起名；`shouldAssess` 还会按阶段/冷却跳过。
4. **减少 evidence 问题**：11 个 noul 可以按需裁到 6–8 个，Jev 延迟还能降一点。
5. **避免 combined 模式**：一次调用看似少一次网络，但把 22 个评估问题 + 起名塞进一个 chat 请求，通常不会比 Jev + GLM 更快，且标签质量更难控。
6. **并发**：队列容量 2、600ms 补 1；快速滑动时不会打爆本地 Magpie。

## 2. 存储形式

当前形式：

```text
xcp:settings      设置
xcp:index         handle 数组
xcp:p:<handle>    单档档案
xcp:usage         日请求
xcp:epoch         清空代际
xcp:stats         近似字节
```

**每个账号一个 GM key**，不是单一大 JSON：

- 单档写入只影响一个 key，避免每次保存重写 4–8MB 的总库。
- `xcp:index` 只在新建/导入/删除时写。
- 300ms 去抖；`pagehide` / hidden 时立即 flush。
- 读路径 `peek` 懒加载单档；启动只读索引，不加载全部档案。

### 单档体积

实测 10 条样本、中文、10 个 seen id、240 字上限：

| 字段 | 字节 |
| --- | ---: |
| `samples`（10 条 × 240 中文） | ~6.9KB |
| `seenIds`（80 条最坏） | ~1.7KB |
| `assessment` | ~0.36KB |
| `history`（5 条）+ `dossier` | ~0.3KB |
| 其他字段 | ~0.2KB |
| **合计** | **~11KB 最坏** |

- 300 档典型实测 **2.0MB**，flush 全部 **14ms**，缓存后 `peek` <1ms，单档 flush **1ms**。
- 900 档典型（6KB/档）约 **5.5MB**；900 档最坏（11KB/档）约 **9.5MB**，超过 7MB 硬限。
- 当前软限 5MB：典型 900 档会淘汰到约 730 档；最坏中文长文约 450 档就触发。
- 典型短文本（80 字）约 4–5KB/档，900 档约 4–4.5MB，仍在软限内。

### 建议

- 个人使用 300–600 档：当前形式足够，不需要压缩。
- 如果要稳定支持 900 档最坏情况（按收益从高到低）：
  1. **压缩样本环**：`SAMPLE_CAP` 10→6、`TEXT_CAP` 240→180，单档约 5–6KB；标签/笔记仍保留。
  2. **缩短 seenIds**：80→50，或存成 base36（19 位数字约 12 字符）。
  3. **提高软限**到 7MB、硬限到 8–9MB（Chrome storage 默认 10MB）；只是把淘汰推迟，不减少体积。
  4. **按配额自适应 compaction**：超限时先裁旧样本/seenIds/history，再淘汰整档；最稳但代码最复杂。
  5. 不建议 gzip 整个档案：GM 需要同步读，CompressionStream 是异步，会让 `peek` 变复杂。
- 不建议改回 IndexedDB：`x.com` 与 `twitter.com` 不同源，会拆成两套档案。
- 不建议单 key 总库：每次保存都会重写全部档案，TM 写入放大更严重。

## 3. 当前默认

```text
评估: jev-latest        ~0.5s
起名: auto/glm-5.3-flash ~2s
首标: 2.5–3.5s
缓存命中: 0 请求
```
