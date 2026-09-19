# lib/ai — 服务端 AI 决策边界(P3.3 契约)

> 状态:**P3.3 契约**。本文档是 AI Provider 边界(请求形状、响应解析、
> 错误映射、重试分类、日志维度、隐私边界)的规范源。任何变更必须以
> 新版本号/新契约发布,不得就地改写已冻结的常量(`*_v1` 后缀)。

无编排、无预算、无持久化:本层只实现「一次决策 = 一次(或有限次重试的)
Responses API 调用」。回合调度、费用控制、记忆与状态保存属于上层运行时,
不在此实现。

## 1. 范围与边界

- 建立 server-only、可替换的 `AiDecisionProvider` 端口;产品运行时只通过
  服务端配置调用 DeepSeek Responses API(`POST {DEEPSEEK_BASE_URL}/responses`)。
- **凭据隔离**:provider 只读 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` /
  `DEEPSEEK_MODEL` / `DEEPSEEK_TIMEOUT_MS` / `DEEPSEEK_MAX_OUTPUT_TOKENS` /
  `GAME_SEAT_HMAC_SECRET` 六个环境名(`DEEPSEEK_ENV_KEYS` 白名单)。任何其他
  凭据 —— 包括 Orbit 任务执行 provider 的凭据、`OPENAI_*`/`ANTHROPIC_*`、
  任何 `NEXT_PUBLIC_*` —— 在构造上不可见,绝不复用。
- 测试只 mock fetch,默认不访问真实 API,不使用 NEXT_PUBLIC 密钥。
- 本层不实现 `core.AiProvider`(`complete({system,prompt})`)的编排;领域端口
  保持不变,上层运行时未来通过本契约做适配。

## 2. 输入契约(最小授权)

`AiTurnInput` 只接受调用者显式传入的:

| 字段 | 说明 |
| --- | --- |
| `gameId` | 不透明服务端对局 id;仅用于派生匿名 user id,绝不原样外发 |
| `seat` | 决策座位(0..63) |
| `phase` | `NIGHT` / `DAY_DISCUSSION` / `DAY_VOTE`(`END` 不是决策阶段) |
| `view` | 最小授权投影:scope ∈ PUBLIC/POST_GAME/PLAYER/TEAM_WOLVES |
| `history` | 公开历史(封闭 union,未知 kind/字段即拒绝) |
| `legalChoices` | 规则引擎的合法选项集(每项 id/seat/label) |

校验(`assertAiTurnInput`,违规 → `INPUT_REJECTED`,输入完全不被使用):

- 顶层只允许上述 6 个键;任何额外字段(如 `serverState`、`name`、`email`)拒绝。
- `view.scope === "SYSTEM"` 或 view 携带 `state` 字段 → 拒绝。**完整 serverState
  永不进入 provider**。
- 座位视图(PLAYER/TEAM_WOLVES)的 `view.seat` 必须等于请求座位。
- 视图字段白名单(`ALLOWED_VIEW_KEYS`)之外的字段拒绝;请求体由
  `pickViewFacts` 显式逐字段构造 —— 即使恶意调用者塞入 seed/roles/夜间
  缓冲/姓名/邮箱,它们也不会进入请求体(构造性零泄露)。
- `authorizedChoices` = `legalChoices` 中 `seat === 请求座位` 的子集;
  结算类(finish-*,seat=null)与其他座位的行为一律不属于本座位,为空即拒绝。

## 3. 请求契约(Responses API)

`buildResponsesRequestBody` 产出的请求体,固定包含且仅包含:

- `model` = `DEEPSEEK_MODEL`(原样发送);
- `input` = system(user 提示词 + 白名单事实 JSON)/ user 消息;
- `reasoning: { effort: "none" }` —— 不做深度推理;
- `max_output_tokens` = min(`DEEPSEEK_MAX_OUTPUT_TOKENS`(默认 1024),
  硬上限 `MAX_OUTPUT_TOKENS_CAP` = 2048);
- `tool_choice: "none"` 且**不传 `tools`** —— 无工具调用能力;
- `text.format` = `{ type: "json_schema", name: <按阶段>, strict: true,
  schema: … }`,其中 `choice_id.enum` 恰为本座位授权选项 id 集合、
  `utterance.maxLength` = `MAX_UTTERANCE_CHARS`(500)、
  `additionalProperties: false`、required 恰为 `choice_id`/`utterance`。
  阶段 schema 名:`decision_night_v1` / `decision_day_discussion_v1` /
  `decision_day_vote_v1`;
- `user` = `anon-<HMAC-SHA256(secret, "game-seat-anon-v1:<gameId>:<seat>)>`
  —— 不可逆匿名 id(§6),不发送姓名、邮箱或任何身份字段;
- `stream: false`。

连接 keep-alive 委托给运行时 fetch(undici 默认连接池):provider 创建时
固定持有一个 fetch 实例,多次决策复用同一实例,不逐调用重建客户端。

## 4. 响应契约(只解析 choice_id 与受限 utterance)

成功响应解析顺序:读取响应体(≤ `MAX_RESPONSE_BYTES`,超出拒绝)→
JSON 解析 → `status === "completed"` → `output[]` 中首个 assistant
message 的 `output_text` → 决策 JSON → 严格校验。拒绝表:

| 情形 | 错误码 | 重试 |
| --- | --- | --- |
| 空响应体 / 非 JSON / 非对象 | `EMPTY_RESPONSE` / `BAD_RESPONSE` | 否 |
| `status: "incomplete"` / message incomplete | `INCOMPLETE_RESPONSE` | 否 |
| refusal / content_filter | `CONTENT_FILTERED` | 否 |
| 决策 JSON 含额外字段(含未定义的 memory patch) | `BAD_RESPONSE` | 否 |
| `choice_id` 不在本座位授权集合(含其他座位的合法选项) | `ILLEGAL_CHOICE` | 否 |
| `utterance` 非字符串或超长 | `BAD_RESPONSE` / `UTTERANCE_TOO_LONG` | 否 |

`ILLEGAL_CHOICE` 的选项**不可能成为命令**;此外任何返回选项在派发为命令前
仍由规则引擎复验(双重防线)。信封层的额外字段(如 `parallel_tool_calls`)
为前向兼容,不影响解析;决策对象本身严格 `{choice_id, utterance}`。

## 5. 错误映射与重试分类(稳定领域错误)

一切失败终态为 `AiProviderError(code)`,`retryable` 是唯一重试依据:

| 触发 | code | 重试 |
| --- | --- | --- |
| 配置缺失/非法 | `CONFIG` | 否 |
| 输入违反 §2 | `INPUT_REJECTED` | 否 |
| HTTP 400 / 422 | `INVALID_REQUEST` | 否 |
| HTTP 401 / 403 | `AUTH_REQUIRED` | 否 |
| HTTP 402 | `PAYMENT_REQUIRED` | 否 |
| HTTP 429 | `RATE_LIMITED` | **是**(尊重 Retry-After,上限 10s) |
| HTTP 5xx | `UPSTREAM_UNAVAILABLE` | **是** |
| DNS/TCP/TLS 瞬时故障 | `NETWORK` | **是** |
| 其余 HTTP 状态 | `UPSTREAM_UNAVAILABLE`(retryable=false) | 否 |
| 服务端超时 | `TIMEOUT` | 否 |
| 调用方 AbortSignal | `ABORTED` | 否 |

重试预算 `maxRetries`(默认 2,即至多 3 次尝试);退避 200ms 起指数翻倍,
上限 5s。**400/401/402/422 永不重试**。超时与中止在每次尝试通过组合
AbortSignal 生效(超时原因与调用方中止可区分)。

## 6. 匿名 user id(不可逆 HMAC)

`anonymousGameSeatId(secret, gameId, seat)` = HMAC-SHA256,域分离前缀
`game-seat-anon-v1`,输出 `anon-<base64url>`。密钥 = 服务端
`GAME_SEAT_HMAC_SECRET`(缺失即 `CONFIG`,拒绝启动调用)。输出确定性、
跨座位/对局/密钥相异、不含 gameId 或 seat 原值;不可逆。

## 7. 观测契约(日志维度)

每次尝试(收到响应或传输失败)通过注入的 `AiLogger` 记录**恰好**以下维度,
不得多不得少:

`requestedModel`、`responseModel`(缺失 null)、`responseId`(缺失 null)、
`httpStatus`(传输失败 null)、`apiStatus`、`systemFingerprint`
(**缺失记 `"unavailable"`**)、`latencyMs`、`inputTokens`、`outputTokens`、
`totalTokens`、`cachedInputTokens`、`reasoningTokens`(后四项缺失 null)。

日志**永不**包含:API Key、姓名/邮箱等 PII、完整 serverState、私有提示词、
reasoning 内容。默认无 logger 时静默;生产建议接 JSON-lines 结构化 sink。

## 8. 验证

`npm run verify:ai-contract`(vitest `tests/ai` 全量 + 静态守卫 +
typecheck)。测试仅 mock fetch,不访问真实 API;测试进程剥离所有
`DEEPSEEK_*` / `GAME_SEAT_HMAC_SECRET` / `NEXT_PUBLIC_*` 环境变量。
真实 API 的最小冒烟属于发布前独立验证(P7.1)。
