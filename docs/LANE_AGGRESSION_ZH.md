# 对线激进度：开关、验收口径与回退

状态：**代码已实现，未做游戏内验证。** 建立在对线只读探针已能取数的前提上。
本文只覆盖对线期压线换血，不涉及技能/物品层，也不涉及任何 LLM 链路。

## 1. 三个开关

全部在 `bots/Customize/general.lua`：

| 开关 | 默认 | 作用 |
|---|---|---|
| `Customize.Enable_Lane_Probe` | `true` | 只读探针，打印 `[LANE]` 采样行。无行为影响 |
| `Customize.Lane_Aggression.Enable` | `false` | 对线激进度总开关 |
| `Customize.Lane_Aggression.Tower_Dive` | `false` | 是否允许塔下压人（风险最高的一项） |

`Lane_Aggression.Enable = false` 时行为与改动前完全一致：9 个 BuggyHero 继续用自己的对线脚本，其余英雄继续走 Valve 默认对线。

## 2. 开关打开后发生了什么

两处行为变化，都在 `bots/mode_laning_generic.lua` 内：

1. **对线循环扩面**：`Think()` 原先只对 9 个 BuggyHero（外加一个 pos1+人类pos5 的边界情况）安装，现在开关打开时对**全部英雄**安装。其余英雄从此使用仓库自己的对线循环（补刀 → 反补 → 换血 → 走位），不再使用 Valve 默认对线。
2. **新增换血与前置站位**（`bots/FunLib/lane_aggression.lua`）：
   - 补刀和反补仍然优先——补刀可用时直接返回，不会为了打人放弃补刀。
   - 之后若换血条件成立，攻击射程内（射程 + `Trade_Range_Bonus`）最近的敌方英雄；目标超出射程则先移动贴近。
   - 兵线站位从"退到敌方最远攻击距离之外"改为"在有敌方英雄时前压到兵线前方 `Forward_Distance`"。没有敌方英雄在 1600 内时保持原逻辑。
   - 前压与换血共用同一个塔距门槛：`Tower_Dive = false` 时，敌方塔 900 内既不换血也不前压。

注意站位的实现语义：开启且安全时，偏移量被**替换**为 `Forward_Distance`，不与原安全偏移做大小比较。原因见 `lane_aggression.lua` 内 `MovementOffset` 的注释——两个偏移量分别相对己方与敌方兵线前沿，量纲不同，不可比。这个比较曾是本模块的一个真实缺陷，已由 `tests/lane_aggression/` 的用例覆盖。

补充：为使 `GetDesire()` 的补刀分支也对新纳入的英雄生效，该分支的进入条件同样加上了开关（见 §4 G2）。

## 3. 调参项

| 字段 | 默认 | 含义 | 调大的后果 |
|---|---|---|---|
| `Forward_Distance` | 120 | 有敌人时在兵线前方多远处站位 | 更压线，也更容易被塔和小兵打 |
| `Trade_Range_Bonus` | 150 | 选目标时额外允许的攻击距离 | 更主动换血，走位更多 |
| `Min_Hp_To_Trade` | 0.30 | 起手换血的最低血量比例 | 更凶，更容易送 |
| `Min_Mana_To_Trade` | 0.20 | 蓝量下限（核心位豁免，因为普攻不吃蓝） | 辅助更激进 |
| `All_Roles_Trade` | `true` | 是否让 1-3 号位也换血 | `false` 则只有 4-5 号位压人 |
| `Tower_Dive` | `false` | 敌方塔 900 内是否仍允许换血**和**前压 | 最凶，死亡风险最高 |
| `Trade_Refresh` | 0.2 | 换血目标重选间隔（秒） | 越小反应越快，开销略高 |

## 4. 验收口径

三个成功必须分开报告，不能混为一谈。

### G1 集成成立

- 日志出现 `[LANE] probe-active|<hero>|playerId|...`，每个 bot 一行。
- `[LANE]` 采样行持续产出，字段数与 `lane_probe.lua` 头部注释一致。
- 开关打开后日志无新增 Lua 报错。

### G2 行为兼容（开关关闭时）

在同一个 stub 场景下，`Lane_Aggression.Enable = false` 必须与改动前**完全一致**：

- `mode_laning_generic.GetDesire()` 的每个返回分支取值不变（本次重构只加了 `DesireFinish` 包装，返回值原样透传）。
- 非 BuggyHero 英雄的 `Think` 仍不存在（不被安装）。
- 探针关闭时无 `[LANE]` 输出。

### G3 不越界

- 新代码不调用 `SkillsComplement` / `Consider*`，不 monkey patch 任何引擎 API。
- 新代码不调用 `Action_ClearActions`，不触碰技能与物品逻辑。
- 换血目标必须是合法、可见、非可疑幻象的敌方英雄。
- `Tower_Dive = false` 时，敌方塔 900 内不得出现新增的换血动作。

### G4 行为改变（开关开启时）

用探针数据做前后对照，同一英雄/位置/对局阶段：

| 指标 | 期望方向 | 数据来源 |
|---|---|---|
| `hero-target rate`（有敌人时指向敌方英雄的比例） | 上升 | 探针 `atkHero`/`tgtHero` 列 |
| `distNearestEnemy` 中位数 | 下降（更贴脸） | 探针字段 |
| `laning mode share` | 上升 | 探针 `activeMode` 列 |
| `last-hit availability` | **不下降**（补刀没有被换血挤掉） | 探针 `hasLastHit` 列 |
| `deaths seen` | 允许上升，但必须给出幅度 | 探针 `deaths` 列 + 记分板 |
| 10 分钟正补 | 不应显著下降 | 记分板 |

`hero-target rate` 是这一版新增的核心指标：它直接测量"AI 有没有真的打人"，而不是从 desire 推断。基线局若此项已经很高，说明问题不在意愿而在站位或模式仲裁，改造重点要换。

**通过标准首先是"补刀没被牺牲、没有停滞、没有报错"**；胜率与压制效果需要成对实验，不能靠单局观感判断。

## 5. 回退

1. **参数级回退**：`Customize.Lane_Aggression.Enable = false`。注意配置是**脚本加载时读取**的：改完需要在下一局开始前生效（重开 lobby），不是改文件后当前局立即变。这是最快的回退，行为回到基线。
2. **单点降级**：只把 `Tower_Dive` 或 `All_Roles_Trade` 调回保守值，用于定位是哪一项导致的死亡上升。
3. **代码级回退**：`lane_aggression.lua` 与本次 `mode_laning_generic.lua` 的改动是独立的一组变更，可单独 revert，不影响探针。

## 6. 建议的测试顺序

1. `Enable_Lane_Probe = true`，`Lane_Aggression.Enable = false` → 跑一局，确认 G1 成立并留下基线数据。
2. 只开 `Lane_Aggression.Enable = true`（`Tower_Dive = false`）→ 跑一局，对照 G4 指标。
3. 若死亡可接受再逐项放开：`All_Roles_Trade` → `Forward_Distance` → `Trade_Range_Bonus` → 最后才是 `Tower_Dive`。
4. 每步只动一个变量。同时改多项会导致无法归因。

## 7. 日志分析与离线验证

### 7.1 拿到日志后怎么分析

```bash
# 单份日志
node tests/lane_probe/analyze_lane_log.js console.log

# baseline 与开启激进度后对照
node tests/lane_probe/analyze_lane_log.js baseline.log after.log
```

输出分三块：采样概况（含 `malformed` 计数）→ 每个英雄的分阶段指标、模式分布、`GetDesire` 分支分布 → 诊断结论。诊断项按"读数 → 结论"给出，`[BAD ]` 表示该项就是当前不凶的原因。

诊断项的判定逻辑：

| 诊断项 | 判定 | 含义 |
|---|---|---|
| `LANING_NEVER_SELECTED` | 对线模式占比 < 10% 时 `[BAD]` | 对线模式根本没被选中。**此时改对线内逻辑无效**，要查上面列出的分支 |
| `lane_mode_share` | <30% `[BAD]`、<60% `[warn]` | 模式仲裁问题，不是对线逻辑问题 |
| `engage_when_enemy_near` | <10% `[BAD]`、<25% `[warn]` | 有敌人在附近时从不贴近 → 站位问题 |
| `queued_action_share` | >60% `[BAD]`、>30% `[warn]` | 动作队列长期非空，技能层被 `J.CanNotUseAbility` 拦死 |
| `creep_aggro_while_laning` | >40% `[warn]` | 小兵仇恨把英雄挤出换血 |
| `hero_target_rate` | <8% `[BAD]`、<25% `[warn]` | **攻击意愿的直接证据**：有敌人时是否真的把目标指向敌方英雄。这是 desire 无法反映的 |
| `deaths_seen` | 仅参考 | 该 bot 探针实例累计死亡数，用于给激进度定价 |
| `lasthit_availability` | 仅参考 | **G4 的不变量**：开启激进度后此值不得下降 |

探针每行 30 列，其中 `atkHero`/`tgtHero`/`deaths` 三列是攻击意愿与代价的直接证据。

`malformed` 不为 0 说明探针输出与解析器列定义不一致——先跑 `check_probe_schema.js` 定位，不要带着错位的数据下判断。

### 7.2 离线验证设施

```bash
node tests/lane_probe/check_probe_schema.js .         # 探针真实输出列 vs 分析器列
node tests/lane_probe/run_probe_logging_test.js .     # 真正执行探针，捕获并校验它打印的行
node tests/lane_probe/run_lane_probe_tests.js         # 分析器自身的 28 项断言
node tests/lane_aggression/run_lane_aggression.js .   # 激进度模块的 24 项行为断言
```

`check_probe_schema.js` 早期版本是**静态解析** `lane_probe.lua` 的文本，它报告"一致"时分析器实际少一列。现在它把探针放进 Lua VM 真跑一次、拿真实输出行与 `COLUMNS` 比对，因此不再会被过时的字段清单骗过。`probe_harness.js` 是两者共用的桩环境。

`make_fixture_logs.js` 生成三种合成日志（passive / aggressive / vetoed），使分析器可以在没有对局的情况下被验证。夹具按探针的真实格式生成：`[LANE]|字段|字段|...`（前缀是独立的表元素，由 `table.concat` 用 `|` 连接，所以前缀后紧跟一个分隔符）。探针的输出现在用显式 `..` 拼接而非 `table.concat`——把前缀和字段放进同一个数组，会让输出列数取决于前缀如何被连接，一个被丢掉的元素就会让所有列错位一格。

依赖隔离在 `tests/.deps/`（只含 `fengari`，不进主 `package.json`）：首次运行前 `cd tests/.deps && npm install --no-audit --no-fund`。

### 7.3 已完成的离线验证

`tests/lane_aggression/run_lane_aggression.js` 在真实 Lua VM（fengari）里加载 `lane_aggression.lua`，用桩替身模拟 Dota API，断言 24 项行为。**当前 24/24 通过**，覆盖：

- 开关关闭时 `Enabled()` 为假、`ThinkTrade` 不动作、`MovementOffset` 原样返回（G2 等价性）。
- 开启后：前压偏移替换、无敌人时不变、对线期之外不变、低血不变、塔可达时不前压。
- 换血：射程内出刀一次、超程只移动不出刀、塔下被拦、`Tower_Dive` 放行、核心位角色开关、幻象永不换血。
- 配置缺失时整体退化为默认（关闭）。

另外对四个改动文件做了 Lua 5.1 语法解析（luaparse）：全部通过。

### 7.4 仍未验证

- **游戏内行为未验证**。离线用例只能证明模块自身的判断逻辑，证明不了引擎确实调用新装的 `Think`、DoD 是否按预期为每个 bot 加载、以及实际对线观感。
- **DoD 风险**：脚本被每个 bot 各加载一次。已在模块层用"配置按需读取 + `Enabled()` 求值"处理；若真机发现开关不生效，优先查这一点。
- **Valve 默认对线的替代**：110+ 英雄从 Valve 的对线逻辑切到仓库自己的循环，属于行为替换而非微调。若出现补刀质量下降或走位异常，应视为本方案的主要风险，先回退开关再分析。
- **`nEnemyCreeps` / `nAllyCreeps` 时序**：这两个本地缓存只在 `GetDesire()` 中刷新。已为三个使用点补 nil 防护；若真机出现空值报错，说明引擎在 `GetDesire` 之前调用了 `Think`。
- **9 个 BuggyHero 双路径**：开关打开后它们的 `local_mode_laning_generic.Think()` 与激进度模块会先后执行，换血优先级高于它们的自有走位。这是有意为之，但需在真机确认没有互相抵消。

### 已修正的实现缺陷（供复查）

| 缺陷 | 发现方式 | 修正 |
|---|---|---|
| 站位偏移用绝对值比较两个不同基准的量，导致前压永不生效 | 离线用例 | 改为直接替换语义 |
| 换血目标缓存被清空后需等满刷新窗口才重选 | 离线用例 | 无目标时立即重选 |
| 调用方传入的敌方英雄列表变化时复用陈旧目标 | 离线用例 | 列表变化即重选 |
| 塔距门槛只作用于换血、不作用于前压 | 复查 | 抽出共用的 `TowerSafe()` |
| 探针头部注释漏列 `heroesTargetingMe`（代码正确，注释漂移） | 分析器 `malformed` 计数 | 注释与代码对齐，并加机械校验 |
| 日志分析器按漂移的注释写成 27 列，少 `isCore` 一列 | 夹具格式比对 | 改为照 `table.concat` 提取，加逐项比对脚本 |
| schema 校验是静态文本解析，曾报告"一致"而分析器实际少一列 | 加探针执行测试后发现 | 改为在 Lua VM 里真跑探针、比对真实输出行 |
| 探针把前缀与字段放进同一个 `table.concat` 数组，列数依赖连接方式 | 上述排查 | 改为显式 `..` 拼接，语义不再有歧义 |
| 测试桩的敌方英雄缺少 `GetAttackTarget()`，探针一带敌人就崩 | 探针执行测试 | 补全桩方法 |
