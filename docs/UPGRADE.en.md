# Upgrade & Data Retention

[中文](UPGRADE.md) | **English**

## Summary

**Updating the same Tampermonkey script does not clear existing labels.**

Storage keys stay the same:

```text
xcp:settings
xcp:index
xcp:p:<handle>
xcp:usage
xcp:epoch
xcp:stats
```

An update replaces code only. `storage.init()` reloads the index; `peek()` lazily loads a profile when needed.

## What survives

| Data | After update |
| --- | --- |
| `label` / `reason` / `vibe` / stage | kept |
| `dossier` | kept |
| `history` | kept |
| `samples` / `assessment` | kept |
| Saved settings (model, key, language, tone) | kept |
| Usage / epoch | kept |

Existing labels are not automatically re-evaluated, and they do not expire because the default model changed. Evolution continues only when stage/cooldown conditions are met.

## Settings and defaults

New defaults apply only to fields that were never saved. If you saved an older model, the update keeps it. To switch to the new default, open Settings and click **Use local Magpie for everything**, then save.

## When data can be lost

- Uninstalling and reinstalling as a new script.
- Changing `@namespace` or installing a duplicate under a different identity.
- Manual “Clear profiles”.
- Browser extension storage cleanup / quota eviction.

Recommendations:

- Update in place; do not uninstall for normal updates.
- Export a JSON backup before major versions.
- Use export/import when moving machines.

## Compatibility

- Profile schema is `v3`.
- `v1` / `v2` profiles migrate on read: `tags[]` → `label`, `level` → `stage`, `locked` dropped.
- Export format is `v2`; import accepts `v1` / `v2`.

## Test

`test/storage-upgrade.test.js` writes a v3 profile with label, history, dossier, assessment and settings, flushes, creates a new storage (simulating reload), and asserts everything survives.
