# 升级与数据保留

[中文](UPGRADE.md) | [English](UPGRADE.en.md)

## 结论

**通过 Tampermonkey 更新同一个脚本，已有标签不会被清空。**

脚本的本地档案 key 没变：

```text
xcp:settings
xcp:index
xcp:p:<handle>
xcp:usage
xcp:epoch
xcp:stats
```

升级只替换代码，不会删除这些 key；启动时 `storage.init()` 重新读索引，`peek()` 按需加载单档。

## 会保留什么

| 数据 | 升级后 |
| --- | --- |
| `label` / `reason` / `vibe` / 等级 | 保留 |
| `dossier` 印象笔记 | 保留 |
| `history` 进化轨迹 | 保留 |
| `samples` / `assessment` | 保留 |
| 已保存的设置（模型、Key、语言、语气） | 保留 |
| 今日用量 / epoch | 保留 |

已有标签不会因为升级自动重评，也不会因为默认模型改变而失效。下一次满足阶段/冷却条件时，才会继续进化。

## 设置与默认值

新版默认值只对**没有保存过的字段**生效。  
如果之前保存过旧模型，升级后仍会用旧模型；想切换到新默认，打开设置点：

```text
全部使用本地 Magpie
```

然后保存。

## 什么情况可能丢数据

- 在 Tampermonkey 里**卸载后重新安装**，可能被视为新脚本，存储上下文可能变化。
- 手动改 `@namespace` 或安装成另一个同名脚本。
- 手动“清空档案”。
- 浏览器扩展存储被清理 / 配额淘汰。

建议：

- 普通更新不要卸载，直接在 Tampermonkey 里更新/覆盖。
- 大版本升级前，菜单 `XCP 导出档案` 备份一次。
- 换电脑时导出/导入。

## 升级兼容

- 档案 schema 当前为 `v3`。
- `v1` / `v2` 旧档案读取时会迁移：`tags[]` → `label`，`level` → `stage`，`locked` 丢弃。
- 未来 schema 升级会提供迁移；不会直接覆盖旧 key。
- 导出格式当前为 `v2`，导入接受 `v1` / `v2`。

## 验证

`test/storage-upgrade.test.js` 模拟了：

1. 写入带标签、历史、笔记、设置的 v3 档案；
2. flush；
3. 新建 storage（等同脚本重载）；
4. `init()` + `peek()`；
5. 断言标签、等级、笔记、历史、assessment、设置全部保留。
