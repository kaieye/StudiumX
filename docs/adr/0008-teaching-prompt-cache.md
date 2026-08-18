# ADR-0008：教学 Prompt Cache 合同

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** prompt-cache

## 背景

教学 prompt 同时包含稳定系统前缀与每 turn 变化的学习上下文。若稳定内容顺序漂移、把动态或敏感内容塞入前缀，provider cache 会失效，并可能跨 turn 泄漏不该复用的数据。

## 决定

- prompt 明确分为稳定、可缓存的 system prefix 与 turn-scoped dynamic tail；稳定段保持确定顺序和稳定序列化。
- LearningSession Evidence、learner answers、tool results、memory body 与临时文件内容只能进入受限 dynamic tail，不进入共享稳定前缀。
- cache fingerprint 覆盖会改变模型可见能力或系统语义的稳定输入；不把 secret、token 或原始用户内容纳入 fingerprint。
- provider cache 只是性能优化；cache miss、provider 不支持或缓存失效不得改变教学语义。
- prompt 内容仍遵守 provenance、外部内容不可信与上下文预算边界。

## 边界与后果

- 不为提高命中率而隐藏能力变化或复用过期教学上下文。
- cache metadata 不是 Teaching Evidence、usage authority 或审计内容替代物。
- 调整稳定前缀形状需要同步评估缓存、隐私与教学影响。
- provider-specific cache 标记不得进入 canonical 教学数据。

## 实施锚点

- [Teaching conversation prompt](../../src/main/teaching-conversation-prompt.ts)
- [Prompt cache 合同测试](../../tests/unit/teaching-prompt-cache.unit.test.ts)
- [Teaching impact 检查](../../scripts/check-teaching-impact.mjs)
