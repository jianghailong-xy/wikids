# lib/games — 游戏领域层（纯 TypeScript）

无网络、无 Next.js、无环境变量、无具体 AI Provider 的纯领域层。唯一例外是
P3 持久化边界：`core/repository.ts` 以**注入**的 drizzle 数据库为端口
（仅导入 drizzle-orm 与 `lib/db/schema` 表结构定义），事务内只有数据库
语句 —— 任何网络/Provider 调用都不允许出现在事务生命周期内（由
`core/tx.ts` 守卫强制）。

## 结构

- `core/` — 通用框架：`GameDefinition` 契约、`GameEngine`（revision 单调、
  事件下标连续、终局吸收、深冻结快照）、`ScriptedBot` + `runBotGame`
  全自动对局驱动器、错误类型（`IllegalActionError` 细粒度 code、
  `StepLimitError` 异常防护）、`Rng`/`Clock`/`AiProvider` 端口（仅接口）。
- `core/repository.ts`（P3）— owner 作用域持久化：事件流为事实源
  （`game_events`，唯一 `(session_id, seq)`、seq 自 0 连续）；snapshot
  仅是带 `last_event_seq`/checksum/四个冻结版本戳的缓存，缺失、损坏、
  seq/checksum/版本不一致一律丢弃并从事件流重建（checksum 为 sha256，
  seq 与事件流交叉核对）；事件追加 + revision/phaseToken CAS + snapshot +
  receipt 在单事务内原子提交；幂等 receipt 唯一 `(session_id, key)`，
  同 key 同 hash 返回存储的稳定响应（只生效一次）、异 hash 冲突；AI
  claim 用**数据库时间** lease（now() 在 SQL 内），过期回收、旧 lease
  结果拒绝（STALE_LEASE）；每次 Provider 尝试（超时/失败/重试）原子计入
  预算与 attempts。种子只在 `game_system_private`（SYSTEM 私有状态）。
- `core/ai.ts`（P3）— `runAiTurn`：claim → Provider 调用（事务外）→
  complete，重试/超时全部计预算；失败兜底选择由
  (seed, phaseToken, seat, purpose) 纯路径派生（`core/fallback.ts`），
  并发完成顺序无关。
- `orchestration/`（P4.1）— 游戏应用服务层：`config.ts` 版本化阈值
  （每决策 1 次瞬态重试/单次超时/单 advance 批次与并发上限、每局
  逻辑调用/HTTP 尝试/Token/轮数预算、每用户并发对局预算，全部带
  N-1/N/N+1 边界测试）；`engine.ts` 可替换决策端口（模型只返回
  choice id + 台词，规则引擎复验后才能成为命令，模型永不写库）；
  `store.ts` 短语句预算记账；`service.ts` 的
  `GameApplicationService`：create/resume/submitCommand/有界 advance
  —— AI 座位经唯一投影器 `viewFor` 获取独立授权观察并与真人走同一
  submitCommand 路径；advance 每次最多推进一个外部 AI 决策（发言严格
  按座位顺序，后发者只见已公开前序发言）或一个互不依赖的冻结批次
  （夜间狼刀/查验、同时投票可并发），结算至多一次，有剩余工作即返回
  pending/retryAfter，绝不在单请求内无限循环；Provider 调用一律在
  事务外，claim 用数据库时间 lease，过期/被回收的 lease 结果拒绝
  （STALE_LEASE），断连后可回收；超时/429/5xx/格式错误/非法目标/
  内容过滤/预算耗尽/开关关闭/无 Key 一律清 pending 走确定性 fallback
  完成整局；`runtime.ts`（server-only）为 Next 路由接线 DeepSeek 引擎
  与 `GAME_AI_ENABLED` 开关。首版运行于现有 Docker 持久 Node runtime，
  不宣称支持无后台设施的短生命周期 serverless。
- `werewolf/` — quick6-v1 生产实现（冻结规格 `docs/quick6-v1-rules.md`）：
  显式阶段状态机、命令/事件/legal choice_id、唯一正向投影器
  `projectView(state, viewer)`（PUBLIC / PLAYER / TEAM_WOLVES / SYSTEM /
  POST_GAME 五种可见范围；真人 API、AI Prompt、重连、回放一律复用，
  禁止先序列化完整 state 再删字段）、确定性事件重放 `replayQuick6`
  （追加序号事件流 + 初始状态折叠；损坏/重复/断序事件显式拒绝）、
  版本化域分离 PRNG（quick6-prng-v1，纯路径派生、并发完成顺序无关）、
  生产 seed 接口（32 字节密码学随机）与脚本机器人。

## 关键不变量

- 每次被接受的命令使 `revision` 恰好 +1；`events[i].index === i`。
- 任何非法命令被拒绝时状态完全不变、不计步（§8 决策表全量覆盖）。
- 终局 `END` 吸收一切动作。
- 随机流 = f(种子字节, 算法版本, 路径)，路径按
  `phaseToken/seat/purpose` 域分离；不存在任何共享可变流。
- 种子与夜间缓冲永不进入投影/事件/客户端载荷（§7、§9）；`SYSTEM`
  是唯一携带完整 state 的范围，仅服务端使用。
- 重放 = f(种子字节, 启动选项, 事件流)：同输入任意前缀输出一致；完整重放
  与终局快照深度相等，唯一无法从公开事件流重建的字段是 §7 私有的
  `seerChecks`（重放状态恒为 `[]`，只读投影、不可续跑）。
- 步数上限（默认 200）触发 `StepLimitError` —— 缺陷信号，绝不伪造和局。

## 验证

`npm run verify:engine` = vitest 全量 + typecheck；引擎测试在
`tests/games/`（规格覆盖、fast-check 属性、≥1000 固定 seed 模拟、
领域 import 边界守卫）。

`npm run verify:persistence`（P3）= 隔离空 Postgres 上从零迁移 + 真实
Postgres 并发/恢复/幂等/lease 套件（`tests/persistence/`，独立 vitest
config，显式拒绝开发 DATABASE_URL）+ typecheck，成功失败均 finally 清理
临时 compose 项目与卷。

`npm run verify:ai-orchestration`（P4.1）= 同样的隔离空 Postgres 流程
（`p4v_` 前缀）上运行 `tests/orchestration/` 套件：create/resume/共享
submitCommand 路径、有界 advance（批次/并发上限、发言顺序可见性、
pending/retryAfter）、数据库时间 lease 与过期结果丢弃、断连回收、
并发重复 advance 只推进一次、瞬态重试与每局/每用户预算的 N-1/N/N+1
边界、各故障/开关关闭/无 Key 的确定性 fallback 整局完成与跨故障
终局一致性、网络调用期间无事务。
