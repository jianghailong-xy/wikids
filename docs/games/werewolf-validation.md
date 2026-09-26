# 狼人杀（quick6）发布验证手册

> 本文档是**可复制执行**的验证手册：每条命令都可以原样粘贴运行。所有验证
> 都在**隔离的临时 Postgres**（随机 compose 工程、随机端口、随机库/用户/密码、
> tmpfs 存储）上进行，从不接触开发数据库；除"真实 DeepSeek smoke"一节外，
> 任何步骤都不需要、也不允许携带真实 DeepSeek Key。

## 1. 前置条件

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | **20.x**（发布门锁定；`npm run verify:release` 会自行通过 nvm 切换到 20 并拒绝在其他大版本下运行） | CI 用 `actions/setup-node` 锁 `node-version: 20` |
| npm | 与 Node 20 配套（10.x） | 干净安装用 `npm ci` |
| Docker | `docker` + `docker compose`（引擎 20+） | 每个 DB 相关脚本自己拉起 `postgres:16-alpine`（生产同款镜像）并负责拆除 |
| Chromium | Playwright 的 Chromium（`npx playwright install --with-deps chromium`） | 仅 UI E2E 步骤需要；verify:game-ui 检测到缺失会自动安装 |
| DeepSeek Key | **默认不需要**（必须为空） | 唯一需要 Key 的是 §6 的显式 opt-in smoke |

## 2. 一键发布门：`npm run verify:release`

```bash
git checkout main && git pull
npm run verify:release
```

期望：**退出码 0**，末行 `✓ verify:release PASSED`。CI（`.github/workflows/release.yml`）
运行的**就是这条同一条命令**。

按顺序执行的 17 步（任何一步失败都会在 `finally` 中拆除资源并以非 0 退出）：

| # | 步骤 | 内容 | 需要 DB/浏览器/Key |
| --- | --- | --- | --- |
| 0 | Node 20 强制 | 非 Node 20 时经 nvm 安装并重执行自身 | — |
| 1 | 凭据隔离 | 环境里有真实 `DEEPSEEK_API_KEY` 时**拒绝运行**；静态断言 `lib/`、`app/` 从不读取 `process.env.ORBIT_*/ANTHROPIC_*/OPENAI_*/MISTRAL_*/GEMINI_*`（Orbit 任务执行凭据与产品运行时密钥严格隔离） | — |
| 2 | `npm ci` | 从 lockfile 干净安装 | — |
| 3 | `npm audit --omit=dev --audit-level=high` | **生产依赖 high/critical 必须为 0** | — |
| 4 | `npm run typecheck` | 全仓 `tsc --noEmit` | — |
| 5 | `npm run verify:engine` | quick6-v1 规则 spec、fast-check 属性测试、**≥1000 个不同 seed 的脚本机器人整局模拟**、域导入边界守卫 | 无 |
| 6 | `npm run verify:domain-security` | 席位×身份×阶段×事件前缀的**可见性 canary 矩阵**（泄漏计数必须恰为 0）、确定性事件**重放**（前缀重放/整局重放/损坏与乱序拒绝） | 无 |
| 7 | `npm run verify:ai-contract` | P3.3 provider 契约（请求形状、Bearer 认证、`reasoning.effort=none`、白名单序列化、超时/400/401/402/422 不重试、429/5xx 限次重试）；mock fetch，**零网络** | 无 |
| 8 | `npm run verify:ai-orchestration` | P4.1 **fallback**：批上限/并发/202 continuation、DB 时间租约、N-1/N/N+1 预算边界，**每种故障/开关关闭/无 Key 路径下确定性 fallback 打完整局** | 隔离 Postgres |
| 9 | `npm run verify:game-safety` | P6.3 **预算/安全**：版本化安全流水线、攻击+正常语料、提示词策略、冻结默认值、全局日预算表、紧急开关整局降级、**game_ai_runs 消毒元数据零泄漏**、30 天保留期清理命令 | 隔离 Postgres |
| 10 | `npm run verify:security-baseline` | 生产 audit、Auth.js smoke（真凭据/错凭据/未认证/错误配置不 fail-open）、**从零迁移+幂等重放** | 隔离 Postgres |
| 11 | `npm run verify:persistence` | **隔离 DB**：属主作用域、原子 append + CAS、并发唯一提交、收据幂等、快照损坏/缺失/seq/校验和恢复、事务内零网络 | 隔离 Postgres |
| 12 | `npm run verify:api` | **隔离 DB + API 黑盒**：401/跨属主 404 字节一致/CSRF/Zod/限流 429/202 续传/幂等/CAS/并发 advance、**provider 关闭（`GAME_AI_ENABLED=0`）与 provider 开启但无 Key 两条 fallback 路径打完整局**、DB 宕机 → 502 泛化响应、响应体 canary 扫描、**数据库值 canary 扫描**（见 §5） | 隔离 Postgres |
| 13 | `npm run verify:game-ui` | **Chromium UI E2E**：大厅→棋盘→终局全链路、三种人类身份、刷新/前进后退恢复、双击与双标签幂等、淘汰观战、provider 故障降级、键盘/a11y/mobile 390px；本地 fake provider 提供真实 HTTP provider 流量（零外网、零凭据） | 隔离 Postgres + Chromium |
| 14 | `npm run build` | **production build**（占位 env，与 Dockerfile builder 一致） | — |
| 15 | `.next/static` canary 扫描 | Key（`sk-…`/`Bearer …`）、邮箱 PII、`reasoning_content`、私有提示词键、`"serverState"`/`"pendingAiSeat"`/`"seedBytes"`/夜相内部键等**泄漏形态正则命中为 0** | — |
| 16 | 日志 canary 扫描 | 整次发布的完整输出按同一组泄漏形态正则扫描 = 0（fixture 域 `@wikids.test` 邮箱豁免） | — |
| 17 | 资源清扫 | 断言没有任何 `wikids-p3v/p4v/p5v/p6v/p6s/d7v/verify-pg` 容器或卷残留，没有 chromium/fake-provider/server 进程残留 | — |

**无 Key 也必须通过**：步骤 12 明确证明"provider 关闭（`AI_PROVIDER_ENABLED=0`/`GAME_AI_ENABLED=0`）"
与"provider 开启但 Key 缺失/配置无效"两条路径下应用都能正常启动、整局游戏通过
确定性 fallback 跑到终局且**没有任何 5xx**——这正是发布门本身运行的环境。

## 3. 隔离 Postgres 是怎么隔离的

每个需要数据库的验证脚本（§2 的 #8–#13）各自：

1. 生成随机 compose 工程名（`wikids-p4v-<hex>` 等）、随机端口、随机库名/用户名/密码；
2. 写入临时目录里的独立 compose 文件，`tmpfs: /var/lib/postgresql/data`
   （无卷、无宿主端口暴露到 0.0.0.0，只绑 127.0.0.1）；
3. 先用 `scripts/assert-isolated-db.mjs` 证明守卫生效：开发库 URL
   （`postgres://postgres:postgres@localhost:5432/wikids`）被**拒绝**、隔离 URL 被接受；
4. 用 `scripts/migrate.mjs` 在**空库上从零迁移**（`drizzle/` 0000..0005 按序应用）；
5. 结束时 `docker compose down -v`（成功与失败路径都执行）并断言容器归零。

开发数据库在验证期间完全不可见、不可写。

## 4. 真实 Auth fixture 与 UI E2E

验证用的用户是**真实 Auth.js 凭据流**创建的：

- `scripts/create-user.mjs` 直接把账号写入隔离库（bcrypt 哈希，与生产一致）；
- 测试经 `/api/auth/csrf` → `/api/auth/callback/credentials` 拿**真实 session cookie**；
- API 黑盒套件与 Chromium E2E 都只带这个 cookie 访问——不绕过任何中间件。

E2E 的浏览器侧（`tests/e2e/game-ui/`）用 `tests/e2e/game-ui/fake-provider.mjs`
起一个本地 HTTP fixture 扮演 DeepSeek Responses API：服务器端真实地构造请求、
走真实网络栈，fixture 做确定性应答——所以 provider 路径是真的，钱不花、Key 不碰。

## 5. Canary 扫描（Key / PII / reasoning / 私有 Prompt / serverState）

三处扫描共享同一组**泄漏形态**正则（只匹配真实泄漏的样子，测试名与散文提到
这些词不会误报）：`sk-<8+>`、`Bearer <8+>`、`DEEPSEEK_API_KEY`/`GAME_SEAT_HMAC_SECRET`、
`"serverState":`、`"seedBytes":`/`"seedHex":`、`"pendingAiSeat":`/`"pendingSeats":`、
`"NIGHT_SEER":`/`"NIGHT_WOLF":`、夜相缓冲键、`"systemPrivate"`/`game_system_private`、
`reasoning_content`/`"reasoningTokens":`、`"systemPrompt":`/`"promptText":`、
内部错误类名、P6.3 植入 canary（`p6s-canary-*`）、邮箱/手机号 PII。

| 扫描对象 | 位置 | 命中即失败 |
| --- | --- | --- |
| 构建产物 | `npm run verify:release` #15 遍历 `.next/static` 全部文本资产 | 任一命中 |
| 日志 | #16 扫描整次发布的完整输出（fixture 域邮箱豁免） | 任一命中 |
| 数据库 | `verify:api` #9.15 用 psql 正则扫 `game_ai_runs`（消毒元数据）、`game_events.payload`、`game_action_receipts.response_json`、`game_snapshots.state_json`（唯一合法持有全量状态的服务器缓存，夜相缓冲与 seed 字节键在此豁免） | 任一命中 |

每次扫描都有**正对照**：数据库扫描先证明同一正则能在 `users.email` 里找到
fixture 邮箱（找不到说明扫描器坏了，同样失败）；DOM 扫描先证明扫描器能识破
故意构造的泄漏。0 命中但扫描器失效的运行不算通过。

## 6. 故障演练清单（已内建在上述门中）

| 故障 | 演练位置 | 期望 |
| --- | --- | --- |
| 无 Key / 开关关闭启动 | verify:api 服务器 A（`GAME_AI_ENABLED=0`）与 B（`AI_PROVIDER_ENABLED=1` 但无 Key） | 启动成功，整局 fallback 完成，无 5xx |
| 全局日预算无效值 | verify:game-safety / runtime | provider 关闭（fail-safe 降级），游戏照常 |
| provider 超时/网络错误/400/401/402/422 | verify:ai-contract + verify:ai-orchestration | 超时与 4xx（429 除外）**永不重试**，限次退避，最终 fallback |
| 429/5xx | verify:ai-contract | 有限重试 + Retry-After，耗尽后 fallback |
| DB 宕机 | verify:api 服务器 C（暂停隔离 Postgres） | `/api/games/sessions` → **502 `{error: service_unavailable}`** 泛化响应（无内部细节），恢复后服务继续 |
| 租约过期/重复领取/乱序事件 | verify:ai-orchestration / verify:persistence | DB 时间租约回收、CAS 拒绝、损坏快照重建 |
| 预算耗尽（每局/每用户/全局） | verify:game-safety / verify:ai-orchestration | 后续决策全部 fallback，游戏不停摆 |
| 提示注入/儿童内容/PII 语料 | verify:game-safety 版本化语料库 | 拦截 + 中性替换，误伤 ≤1% |

## 7. 数据清理

- **验证数据**：全部验证数据只存在于临时 Postgres（tmpfs），`down -v` 后随容器消失；
  每个脚本在 `finally` 中拆除（成功与失败同样拆除），发布门 #17 断言无残留。
- **浏览器产物**：E2E 用临时 profile，套件结束时关闭浏览器；#17 断言无 chromium 残留进程。
- **生产数据**：完成的游戏与其 AI 元数据按保留期删除——`GAME_RETENTION_DAYS`
  （默认 30，范围 1..3650，冻结于 P6.3）由
  `docker compose --profile maintenance up cleanup` 或
  `node scripts/cleanup-games.mjs --days=30 --apply` 执行；
  **进行中的游戏无论多老都绝不删除**。生产迁移在容器启动时自动运行
  （Dockerfile CMD：`node scripts/migrate.mjs && node server.js`，幂等）。

## 8. 真实 DeepSeek smoke（显式 opt-in，**不是发布门的一部分**）

发布门永远不碰真实 API。确认真实链路时，**显式**运行：

```bash
REAL_DEEPSEEK_SMOKE=1 DEEPSEEK_API_KEY=<你的产品Key> npm run verify:deepseek-smoke
```

- 双重显式门槛：`REAL_DEEPSEEK_SMOKE=1` **且** `DEEPSEEK_API_KEY` 非空，缺一即拒绝；
  `AI_PROVIDER_ENABLED=0` 时同样拒绝。
- 只用你给的产品 Key——**绝不复用 Orbit 任务执行凭据或任何其他 provider 的凭据**
  （`lib/ai/providers/deepseek.ts` 只读固定的服务端白名单环境名）。
- 成本上限：隔离库里起 1 个用户、1 局游戏，有界 advance 直到**第一批**真实决策
  完成（quick6 一批最多 5 个决策、每次 `max_output_tokens=256`，最多几百 token）。
- 断言：至少一条 `game_ai_runs` 记录 `fallback=false`、`provider='deepseek'`、
  `prompt_version='prompt-v1'`，且只留下消毒元数据（§5 同款零泄漏扫描）；
  连不上真实 API 时 smoke **失败**（这正是它存在的意义——它证明真实链路可用）。
- 发往 provider 的始终是产品一贯发送的匿名席位视图（HMAC 匿名 user id，
  无姓名/邮箱/原始席位 id——P3.3）。
- 结束时照常 `down -v` + 删除临时目录。

## 9. 常见问题

**Q: 本机 Node 不是 20？** 发布门会自动经 nvm 安装/切换到 Node 20 再重执行自身
（`nvm` 不可用时给出明确报错）。CI 由 `actions/setup-node` 锁 20。

**Q: 环境里有 DEEPSEEK_API_KEY？** 发布门**拒绝运行**。它只证明无 Key/开关关闭的
fallback 路径；真实链路请走 §8。

**Q: 失败时资源会残留吗？** 不会。每个 DB 脚本的拆除都在 `finally` 里；发布门 #17
还会复核一遍容器/卷/进程。发布门自己的临时目录（含日志）在成功时删除，
失败时保留并打印路径供排查。

**Q: 想只跑其中一段？** 直接跑对应命令即可（§2 表格里的 `npm run verify:*`），
每个脚本本身就是一条可独立运行的完整验证。
