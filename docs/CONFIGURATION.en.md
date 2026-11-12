# Configuration & Models

[中文](CONFIGURATION.md) | **English**

## Modes

| Mode | Evaluator | Namer | Key |
| --- | --- | --- | --- |
| Local Magpie (default) | `http://127.0.0.1:3425/v1` + `jev-latest` | `http://127.0.0.1:3425/v1/chat/completions` + any chat model | none |
| Direct TypeSafe + cloud Namer | `https://api.typesafe.ai/v1` + `jev-latest` | OpenAI-compatible | required |
| Combined | `combined` | one model outputs assessment + label | required |
| Jev only | `jev-latest` | local fallback composer | none |

Magpie proxies both `/v1/systemone` and `/v1/chat/completions`, so both stages are zero-key.

## Settings

| Field | Default | Notes |
| --- | --- | --- |
| Evaluator mode | Jev + generative naming | `jev` / `combined` |
| Jev URL | `http://127.0.0.1:3425/v1` | `/systemone` is appended |
| Jev model | `jev-latest` | System One model |
| Jev key | empty | local Magpie needs none |
| Namer provider | `openai` | OpenAI-compatible |
| Namer URL | `http://127.0.0.1:3425/v1/chat/completions` | local Magpie |
| Namer model | `auto/glm-5.3-flash` | any chat model |
| Namer key | empty | local Magpie needs none |
| Label language | `auto` | `auto/zh/en/ja/ko/es/fr/de/ru` |
| Tone | `sharp` | `sharp/soft/abstract/chuuni/academic` |
| Temperature | 0.7 | naming creativity |
| Dwell | 500ms | 300–2000 |
| Daily budget | 400 | 0 = unlimited |
| Auto-label all | on | every account with samples |

## Local Magpie models

```bash
curl -s http://127.0.0.1:3425/v1/models | jq -r '.data[].id'
```

Evaluator must be a System One model (`jev-latest`, `jev-preview`). Namer can be any chat model.

Recommended namers:

- `auto/glm-5.3-flash` — fast, default
- `auto/kimi-k3` — good balance
- `auto/deepseek-v4.1-flash` — more stable, ~3× slower
- `auto/qwen3.8-max` — strong Chinese, can be slow
- `auto/gpt-6-luna` / `auto/gemini-3.8-flash` — more varied style

Reasoning models count reasoning tokens against `max_tokens`; naming uses 1500.

## Multilingual

`labelLang` controls label, reason and dossier language; samples are never translated.

| Language | Validation |
| --- | --- |
| zh | 3–10 Han characters + ≤2 ASCII |
| en/es/fr/de | 1–3 words, ≤18 characters |
| ja | 3–12 characters, Latin allowed |
| ko | 2–12 characters |
| ru | 1–3 words (Latin rules) |

Invalid labels are rejected; `failCount` increases. Two failures freeze automatic evolution; manual re-evaluation still works.

## Storage & privacy

Keys:

```text
xcp:settings
xcp:index
xcp:p:<handle>
xcp:usage
xcp:epoch
xcp:stats
```

Exports exclude settings, keys, usage, `seenIds` and `shortHits`. Imports use a whitelist, reset transient fields and clamp future timestamps to now + 7 days.

## Error codes

| Code | Meaning | Action |
| --- | --- | --- |
| `HTTP 451` | TypeSafe region block | use local Magpie or a proxy |
| `EMPTY` | empty model content | switch model; max_tokens 1500 |
| `BAD_JSON` | non-JSON output | retry; JSON mode falls back once |
| `BAD_LABEL` | invalid label shape/category | reject; manual re-evaluate |
| `BAD_ENDPOINT` | invalid URL | local http only for localhost/127.0.0.1/[::1] |
| `TOO_LARGE` | response >50KB | rejected, counted as failure |
| `TRUNCATED` | `finish_reason=length` | counted as failure |

## Auto-update

`src/userscript.header`:

```text
https://raw.githubusercontent.com/JohnWangggg/x-cyber-profiler/main/dist/x-cyber-profiler.user.js
```

Release:

```bash
npm run release -- patch
git add -A && git commit -m "release vX.Y.Z" && git push
```
