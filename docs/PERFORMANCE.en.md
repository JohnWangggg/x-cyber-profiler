# Performance & Storage

[中文](PERFORMANCE.md) | **English**

Environment: macOS arm64, Node 26, local Magpie `127.0.0.1:3425`, Jev `1.14.0`.

```bash
node tools/bench.mjs
node tools/storage-bench.mjs 300
node tools/storage-bench.mjs 900
```

## Generation speed

Two samples, English label, `tone=sharp`, `max_tokens=1500`:

| Stage | Model | Latency | Output tokens |
| --- | --- | ---: | ---: |
| Jev System One | `jev-latest` | **493ms** | 403 |
| Naming | `auto/glm-5.3-flash` | **1.9–2.9s** | 62–72 |
| Naming | `auto/kimi-k3` | 3.8s | 62 |
| Naming | `auto/deepseek-v4.1-flash` | 6.0s | 489 |
| Naming | `auto/gpt-6-luna` | 6.6s | 333 |
| Naming | `auto/qwen3.8-max` | 29.3s | 1041 |

- Jev is not the bottleneck.
- The default namer is GLM Flash, about 2–3× faster than DeepSeek Flash.
- Final label latency is roughly **2.5–3.5s** including the 500ms dwell.
- Since 1.0.4, a **provisional label** is shown right after Jev (~0.8–1.2s) and replaced by the final label.
- Cached profiles render instantly with zero network requests.
- Lookahead pre-render fills cached labels for the current and next screen.

## Storage

```text
xcp:settings
xcp:index
xcp:p:<handle>
xcp:usage
xcp:epoch
xcp:stats
```

One GM key per profile; the index is written only when accounts are added/removed. Startup reads only the index; profiles are lazy-loaded.

Measured (300 profiles, 10 samples, Chinese, 240-char cap, 10 seen ids):

```text
total       2.0MB
per profile 6.8KB
flush all   14ms
one flush   1ms
cached peek <1ms
```

900 profiles:

```text
commit      39ms
flush       48ms
total       5.5MB
kept        729 (5MB soft limit evicted 171)
```

Worst case (10 × 240 Chinese chars + 80 seen ids): ~11KB/profile → ~9.5MB for 900. This exceeds the 7MB hard limit.

Recommendations:

- 300–600 profiles: current form is fine.
- For worst-case 900:
  1. compact sample ring: `SAMPLE_CAP` 10→6, `TEXT_CAP` 240→180;
  2. shorten `SEEN_CAP` 80→50 or store status IDs in base36;
  3. raise the soft limit to 7MB and hard limit to 8–9MB;
  4. add quota-aware compaction before full eviction.
- Do not switch to a single JSON blob (write amplification) or IndexedDB (x.com/twitter.com origins split).
