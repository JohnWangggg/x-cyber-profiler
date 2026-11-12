# Changelog

[中文](CHANGELOG.md) | **English**

## 1.0.5 — 2026-11-12

- Public repository cleaned: internal requirement/design docs removed.
- Chinese and English documentation: README, configuration, upgrade, performance, changelog.
- No behavior changes.

## 1.0.4 — 2026-11-12

- Provisional label right after Jev; final label replaces it.
- Lookahead pre-render for cached labels on the current/next screen.
- Provisional labels do not pollute history; they remain as fallback if naming fails.

## 1.0.3 — 2026-11-12

- Default namer changed to `auto/glm-5.3-flash` (2–3× faster than DeepSeek Flash).
- Added performance/storage benchmarks and docs.

## 1.0.2 — 2026-11-12

- TypeSafe System One API (`POST /v1/systemone`, 22 questions).
- Local Magpie defaults: `jev-latest` + `auto/glm-5.3-flash`, zero keys.
- Local Magpie presets; keyless local evaluator/namer; `/` allowed in model IDs.
- Token cap 1500 for reasoning models.
- Fixes: cross-tab usage, quota eviction, 451 handling, quote anchors, capture-phase events, touch long-press, import timestamps.

## 1.0.1 — 2026-11-12

- Connection tests and restore-hidden in settings.
- Touch long-press evidence card.
- Additive cross-tab usage.

## 1.0.0 — 2026-11-12

- First installable build: viewport sampling, local profiles, Jev + Namer, six-vibe badges, hover card, import/export.
