// A deterministic stand-in for the DeepSeek Responses API (P6.1 E2E fixture).
//
// The game server reaches it through the documented server-only configuration
// (DEEPSEEK_BASE_URL pointed at this process), so the browser suite exercises
// the real provider path — request contract, json_schema choice enum, strict
// decision parsing, per-decision retries and the deterministic fallback — with
// no network and no credential.
//
// The policy is a pure function of the authorized choice enum the server sent,
// so a whole game is reproducible:
//   * night  — the smallest authorized target (every wolf picks the same one,
//              which keeps the night unanimous and the PRNG tiebreak unused);
//   * speech — the seat speaks one fixed line (no skip), so the public timeline
//              carries AI speeches;
//   * vote   — the smallest authorized target.
//
// `mode` flips the endpoint between answering and failing with an upstream 5xx
// (the "provider 故障" scenario): the server must absorb that into the
// application fallback and still finish the game.
import { createServer } from "node:http";

const SPEECH_LINE = "我先说说我的看法，听听大家的线索。";

/** How long the failing upstream takes to answer (before its retry). */
const FAIL_DELAY_MS = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The deterministic decision for one authorized choice enum.
 *
 * `policy` picks which end of the licensed target list the AI aims at:
 * - "smallest" — the lowest-numbered target. The human holds seat 1, so this
 *   removes the human early: the eliminated-player (spectating) scenario.
 * - "largest" — the highest-numbered target, which keeps the human in the
 *   game for the rounds they play.
 * Either way every agent in a phase agrees, so the night never needs the PRNG
 * tiebreak and the whole game is reproducible.
 */
export function chooseFor(choices, policy = "smallest") {
  const speech = choices.find((id) => id.startsWith("speech@"));
  if (speech !== undefined) return { choice_id: speech, utterance: SPEECH_LINE };
  const skip = choices.find((id) => id.startsWith("skip@"));
  const targeted = choices
    .filter((id) => /@\d+:\d+$/.test(id))
    .map((id) => ({ id, target: Number(id.slice(id.lastIndexOf(":") + 1)) }))
    .sort((a, b) => (policy === "largest" ? b.target - a.target : a.target - b.target) || a.id.localeCompare(b.id));
  if (targeted.length > 0) return { choice_id: targeted[0].id, utterance: SPEECH_LINE };
  if (skip !== undefined) return { choice_id: skip, utterance: SPEECH_LINE };
  return { choice_id: choices[0], utterance: SPEECH_LINE };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/**
 * Start the fixture on an ephemeral localhost port.
 * Returns { baseUrl, state, setMode, close }.
 */
export async function startFakeProvider() {
  const state = { mode: "ok", policy: "smallest", requests: 0, decisions: [], lastPrompt: null };
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === "POST" && req.url === "/__mode") {
        const body = JSON.parse((await readBody(req)) || "{}");
        state.mode = body.mode === "fail" ? "fail" : "ok";
        if (body.policy === "smallest" || body.policy === "largest") state.policy = body.policy;
        return json(res, 200, { mode: state.mode, policy: state.policy });
      }
      if (req.method === "GET" && req.url === "/__state") {
        return json(res, 200, {
          mode: state.mode,
          policy: state.policy,
          requests: state.requests,
          decisions: state.decisions,
        });
      }
      if (req.method !== "POST" || !req.url.endsWith("/responses")) {
        return json(res, 404, { error: { message: "not found" } });
      }

      state.requests += 1;
      const raw = await readBody(req);
      if (state.mode === "fail") {
        // An upstream that is failing after a connect timeout: the server has
        // to absorb the latency as well as the error, which is the shape that
        // makes the client ease its own continuation cadence (§6 AI 降级).
        await sleep(FAIL_DELAY_MS);
        return json(res, 503, { error: { message: "fixture upstream failure" } });
      }

      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(res, 400, { error: { message: "invalid json" } });
      }
      state.lastPrompt = raw;
      const choices = body?.text?.format?.schema?.properties?.choice_id?.enum;
      if (!Array.isArray(choices) || choices.length === 0) {
        return json(res, 400, { error: { message: "no authorized choices" } });
      }
      const decision = chooseFor(choices, state.policy);
      state.decisions.push(decision.choice_id);
      return json(res, 200, {
        id: `resp_${state.requests}`,
        model: body?.model ?? "fake-model",
        status: "completed",
        system_fingerprint: "fp_fixture",
        output: [
          {
            type: "message",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(decision) }],
          },
        ],
        usage: { input_tokens: 120, output_tokens: 24, total_tokens: 144 },
      });
    })().catch(() => {
      if (!res.headersSent) json(res, 500, { error: { message: "fixture failure" } });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    setMode: (mode) => {
      state.mode = mode === "fail" ? "fail" : "ok";
      return state.mode;
    },
    setPolicy: (policy) => {
      state.policy = policy === "largest" ? "largest" : "smallest";
      return state.policy;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
