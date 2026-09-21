# 游戏 API：玩家视图协议（P5.1）

> 状态：**冻结（frozen）**。本文档是 `app/api/games/sessions/**` Route Handlers
> 的规范源；任何破坏性修改必须以新协议版本发布，不得就地改写。
> 配套黑盒验证：`npm run verify:api`（隔离 Postgres + 真实 Next server +
> 真实 Auth cookie）。

## 端点

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| POST | `/api/games/sessions` | 创建对局（每用户最多 1 个 active quick6） |
| GET | `/api/games/sessions?gameDefinitionId=&status=` | 大厅列表（owner 作用域，可按定义/状态过滤） |
| GET | `/api/games/sessions/[id]?since=` | 恢复/刷新玩家视图 |
| POST | `/api/games/sessions/[id]/actions` | 提交本人动作（幂等 + CAS） |
| POST | `/api/games/sessions/[id]/advance` | 有界推进（202 续推） |
| POST | `/api/games/sessions/[id]/abandon` | 显式放弃（释放 active 配额，可重开） |

## 会话信封（SessionEnvelope）

成功响应只包含以下字段，**绝不**包含 serverState、内部子阶段、pending AI
座位、Provider 细节或任何服务端私有状态：

```jsonc
{
  "sessionId": "uuid",
  "gameDefinitionId": "quick6-v1",
  "status": "active | finished | aborted | abandoned", // 泛化状态
  "revision": 3,                 // CAS 基线（每接受一次迁移恰好 +1）
  "phaseToken": "night:2",       // CAS 相位令牌（下一请求的 expectedPhaseToken）
  "projectView": { ... },        // 唯一正向投影器 viewFor(本人座位)；终局后为全员揭示
  "legalActions": [ { "id": "wolf-kill@0:3", "label": "狼人 0 刀 3" } ], // 仅本人座位；不含系统结算
  "increments": [ ... ],         // 可见增量：revision > 客户端 since 的公开事件
  "pending": false,              // advance 返回 202 且仍有工作时为 true
  "retryAfterMs": 0              // pending 时客户端应等待后再次 advance
}
```

- 动作响应 = 信封 + `applied: boolean`（false = 幂等 receipt 重放，只生效一次）。
- 放弃响应 = `{ "sessionId": "...", "status": "abandoned" }`。

## 动作请求

```jsonc
{
  "idempotencyKey": "k-123",      // 每 session 唯一；同键同载荷重放稳定响应
  "expectedRevision": 2,          // 客户端最后所见 revision；旧值 → 409 stale
  "phaseToken": "night:1",        // 同上；不匹配 → 409 stale（code 区分）
  "command": {
    "type": "SUBMIT_WOLF_KILL | SUBMIT_SEER_CHECK | SUBMIT_SPEECH | SUBMIT_DAY_VOTE",
    "seat": 0,                    // 必须等于本人座位（服务端解析，不可冒充）
    "target": 3                   // SPEECH 用 "text": string|null（≤240，P6.3）
  }
}
```

结算命令（FINISH_*）是系统专属，不在公开 schema 中；请求代其他座位行动 →
403 forbidden。

## 状态码与稳定错误码

| 状态 | error（稳定、泛化） | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 无有效会话（每个接口显式检查 `session.user.id`） |
| 403 | `cross_origin_forbidden` | cookie 鉴权的写请求 Origin 非同源 / Sec-Fetch-Site: cross-site |
| 403 | `forbidden` | 越座/越权命令 |
| 404 | `not_found` | **不存在与非 owner 完全同码同正文**（防枚举）；非 UUID id 同 |
| 400 | `invalid_body` | Zod 校验失败 / JSON 解析失败 |
| 400 | `invalid_start` | 角色表不是 §1 多重集等 |
| 400 | `invalid_game_definition` | 不支持的 gameDefinitionId |
| 409 | `active_session_exists` | 已有 1 个 active quick6（放弃后可重开） |
| 409 | `stale` (+`code: revision_conflict\|phase_conflict`) | CAS 基线过期（旧版本请求） |
| 409 | `idempotency_conflict` | 同键异载荷 |
| 409 | `illegal_action` | 规则引擎拒绝（§8） |
| 409 | `session_not_active` | 对 finished/aborted/abandoned 对局动作/推进 |
| 413 | `payload_too_large` | 超过请求体上限 |
| 415 | `unsupported_media_type` | Content-Type 非 JSON |
| 429 | `rate_limited` | **仅**用户级创建/动作频率限流（滑窗，可 Retry-After） |
| 429 | `advance_in_progress` | **仅**同 session 并发 advance 限流（至多 1 个在飞） |
| 429 | `daily_limit_exceeded` | P6.3：用户当日创建对局数达上限（10，可 Retry-After） |
| 500 | `internal_error` | 未预期错误（正文泛化；细节只进服务端日志） |
| 502 | `service_unavailable` | **仅**真正不可恢复的基础设施故障（数据库连通性） |

Provider 超时/上游 429/5xx/内容过滤/模型预算耗尽一律由应用层（P4.1）吸收为
确定性 fallback，**永远不会**以卡阶段、5xx 或 429 的形式出现在本层。

## 鉴权与安全

- 全部复用 Auth.js（JWT 会话 cookie）；中间件不覆盖 /api，由每个 handler
  自行显式检查。
- 写请求（POST）必须 same-origin：`Origin` 头（若存在）必须等于请求自身
  origin；`Sec-Fetch-Site: cross-site` 直接拒绝。
- 请求体：Zod `.strict()` 校验；Content-Type 必须 `application/json`
  （+json 亦可）；大小上限 `GAME_API_MAX_BODY_BYTES`（默认 16 KB）。
- 速率：创建类 `GAME_RATE_CREATE_PER_MINUTE`（默认 10/分/用户）、动作类
  `GAME_RATE_ACTION_PER_MINUTE`（默认 120/分/用户），60 秒滑窗，进程内
  （对应持久 Node runtime）；每个已认证写请求先于业务校验计数（与后续
  400/409/404 结果无关），边界因此可被稳定观测。

## 验证

`npm run verify:api` — 隔离一次性 Postgres（`p5v_` 前缀，拒绝开发库）上从零
迁移，真实 `next build` standalone server + 真实 Auth cookie 黑盒覆盖：
双用户越权、列表/创建/恢复/放弃、跨站 POST、刷新、重复请求、202 续推、
并发 advance、速率边界、Provider 关闭/坏配置下整局 fallback 完成、DB 断连
502、响应/HTML/RSC/错误体 canary 泄漏 = 0。
