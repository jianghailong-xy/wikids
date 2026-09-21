/**
 * Deterministic unsafe-content classifier (P6.3).
 *
 * A message (player speech or AI utterance) is unsafe when it carries at
 * least one marker from the frozen pattern table below. The classifier is
 * deliberately conservative and game-aware: normal werewolf gameplay —
 * suspicion, accusations, votes, "刀/投/查" in-game violence, asking "你是
 * 狼人吗" — is never flagged, while the eight attack categories of the
 * versioned corpus (instruction override, system-prompt manipulation, role
 * solicitation, forged choices, Unicode confusion, HTML/Markdown injection,
 * real-world threats and child-inappropriate content) are.
 *
 * The pattern table is pure data and frozen with the policy version; a
 * future change ships as a new policy version, never as a silent edit.
 */

/** One unsafe marker: a category plus its frozen pattern. */
interface UnsafePattern {
  readonly category: string;
  readonly pattern: RegExp;
}

const UNSAFE_PATTERNS: readonly UnsafePattern[] = [
  // -- instruction_override: attempts to re-role or re-instruct the model
  { category: "instruction_override", pattern: /忽略(以上|之前|所有|这些|游戏规则)/ },
  { category: "instruction_override", pattern: /(ignore|disregard|forget|override|bypass)\s*(all|previous|above|these|the)?\s*(instructions|rules|prompts)?/i },
  { category: "instruction_override", pattern: /你现在是|你的新(角色|任务|指令|身份)|从现在起?你是/ },
  { category: "instruction_override", pattern: /(you are now|act as|pretend to be|roleplay as|you must obey)/i },
  { category: "instruction_override", pattern: /(开发者模式|越狱|无条件服从|必须服从|优先执行)/ },
  { category: "instruction_override", pattern: /(jailbreak|developer mode|dan mode)/i },
  { category: "instruction_override", pattern: /(废除|解除|取消)(游戏)?(规则|限制|指令)/ },
  { category: "instruction_override", pattern: /无视(系统|规则|指令|设定)/ },
  // -- system_prompt: probing or overriding the system layer
  { category: "system_prompt", pattern: /系统(提示|消息|指令|设定|规则)/ },
  { category: "system_prompt", pattern: /初始(指令|提示|设定)/ },
  { category: "system_prompt", pattern: /system\s*(prompt|message|instructions)/i },
  { category: "system_prompt", pattern: /<\|(im_start|im_end|endoftext|system)\|?>/i },
  { category: "system_prompt", pattern: /(prompt|提示词)(泄露|泄漏|leak)/i },
  { category: "system_prompt", pattern: /提示词是什么|what is your prompt/i },
  { category: "system_prompt", pattern: /(重复|复述|打印|输出)(你的)?(系统|初始)(提示|指令|设定)/ },
  { category: "system_prompt", pattern: /reveal (your )?(system |initial )?(prompt|instructions)/i },
  // -- role_leak: soliciting identities (own or others')
  { category: "role_leak", pattern: /告诉我(你的)?(真实)?(身份|角色|底牌)/ },
  { category: "role_leak", pattern: /(说出|透露|泄露|坦白)(你的)?(真实)?(身份|角色|底牌)/ },
  { category: "role_leak", pattern: /(reveal|show me|tell me|leak) your (true )?(role|identity)/i },
  { category: "role_leak", pattern: /(所有玩家?|所有人)的(角色|身份)/ },
  { category: "role_leak", pattern: /把(角色|身份)(名单|列表|表)/ },
  { category: "role_leak", pattern: /everyone'?s (role|identity)|list (all )?roles/i },
  // -- forged_choice: attempting to forge commands / choice ids
  { category: "forged_choice", pattern: /choice[_]?id/i },
  { category: "forged_choice", pattern: /"type"\s*:/ },
  { category: "forged_choice", pattern: /(wolf-kill|seer-check|day-vote|skip|speech)@\d/i },
  { category: "forged_choice", pattern: /finish-(night|discussion|vote)/i },
  { category: "forged_choice", pattern: /\{"choice_id"|\{"utterance"/i },
  // -- unicode_confusion: lookalike scripts, full-width Latin, invisible controls
  { category: "unicode_confusion", pattern: /[Ѐ-ӿͰ-Ͽ]/ },
  { category: "unicode_confusion", pattern: /[Ａ-Ｚａ-ｚ]/ },
  { category: "unicode_confusion", pattern: /[​-‏‪-‮⁠-⁤﻿]/ },
  { category: "unicode_confusion", pattern: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/ },
  // -- html_markdown: markup injection
  { category: "html_markdown", pattern: /<\s*\/?\s*(script|img|iframe|a|style|svg|video|audio|form|input|link|meta|object|embed|textarea)\b/i },
  { category: "html_markdown", pattern: /javascript\s*:/i },
  { category: "html_markdown", pattern: /\bon\w+\s*=/i },
  { category: "html_markdown", pattern: /\[[^\]]{0,80}\]\([^)\s]{1,200}\)/ },
  { category: "html_markdown", pattern: /!\[[^\]]*\]/ },
  { category: "html_markdown", pattern: /```/ },
  // -- real_world_threat: self-harm, doxing, violence against real persons
  { category: "real_world_threat", pattern: /自杀|跳楼|割腕|自残|想不开|活不下去/ },
  { category: "real_world_threat", pattern: /(kill|harm)\s+(myself|yourself|themselves)|self[-\s]?harm|suicid/i },
  { category: "real_world_threat", pattern: /(人肉|曝光.*(?:地址|电话|学校|家庭)|公布.*个人信息)/ },
  { category: "real_world_threat", pattern: /(杀了你|弄死你|打死你|砍了你|打断你的腿|杀了你全家|灭你满门|让你消失)/ },
  { category: "real_world_threat", pattern: /(学校|班级|家里|家门|校门口|放学|线下|现实里).{0,12}(杀了|弄死|打死|堵你|揍你|收拾你|打你|砍)/ },
  { category: "real_world_threat", pattern: /(杀了|弄死|打死|堵|揍|收拾)(你|你全家).{0,12}(学校|班级|家里|家门|校门口|放学|线下|现实里)/ },
  // -- child_inappropriate: sexual / drug content
  { category: "child_inappropriate", pattern: /色情|裸照|裸体|脱衣|淫秽|嫖娼|性交|做爱|生殖器|自慰/ },
  { category: "child_inappropriate", pattern: /(porn(ography)?|nudes?|naked|sex(ual)?\s*(content|acts?)?|genitals?|masturbat\w*|intercourse)/i },
  { category: "child_inappropriate", pattern: /毒品|吸毒|海洛因|冰毒|大麻|摇头丸|可卡因|麻古/ },
  { category: "child_inappropriate", pattern: /(heroin|cocaine|meth(amphetamine)?|marijuana|weed)\b/i },
];

/** Which unsafe categories the text matches (empty = safe). */
export function unsafeCategories(text: string): string[] {
  const found = new Set<string>();
  for (const { category, pattern } of UNSAFE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.add(category);
  }
  return [...found];
}

/** True when the text carries at least one unsafe marker. */
export function isUnsafeText(text: string): boolean {
  for (const { pattern } of UNSAFE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
