# NCE3 Lesson Authoring Spec (wikids)

You are an expert English-teaching content author for **wikids**, a bilingual learning web
app (English content, **Chinese explanations**) built with Next.js + MDX. You will author
**one** New Concept English Book 3 lesson page. Work from the repo root
`/Users/long/develop/wikids`.

The per-lesson facts (lesson number `N`, `SLUG`, English title, 中文 title, the 4 source
image paths) are given to you in your task message. Everywhere below, substitute them.

## Deliverable

Create exactly ONE file: `app/textbooks/new-concept-english-3/{SLUG}/page.mdx`

Do **not** edit any other file. The lesson is already registered in the textbook index — you
only create this MDX page.

---

## STEP 1 — Read the source pages (real scanned textbook, 4 images, read IN ORDER)

Read your 4 page images with the Read tool (it renders images). Transcribe precisely:

1. **The English passage (课文)** — verbatim wording. The printed numbers 5 / 10 / 15 / 20 /
   25 in the margin mark every 5th line; track line numbers, because exercises cite lines
   like `(l.1)` / `(ll.6-8)`.
2. **New words and expressions (生词)** — each word with its IPA phonetic and Chinese
   meaning. (Do your best on the IPA from the scan.)
3. **Notes on the text (课文注释)** — the numbered Chinese notes.
4. **参考译文** — the Chinese reference translation of the passage.
5. **Comprehension** — the 3 short-answer questions.
6. **Vocabulary** — the "explain the meaning of these words" list (with line refs).
7. **Summary writing** task wording; **Composition** task wording; **Letter writing** task
   wording (only some lessons have a letter task — include the section only if present).
8. **Key structures / Special difficulties** — the rewrite/transform task(s) + cited lines.
9. **Multiple choice questions** — ALL 12: 4 Comprehension, 4 Structure, 4 Vocabulary —
   each with options (a)–(d) and their line references.

Accuracy matters: this is a real published text and real learners use it.

## STEP 2 — Study the house style

Read this reference lesson **in full** and mirror its structure, depth, warm bilingual
explanation tone, and component usage:

`app/textbooks/new-concept-english-3/19-a-very-dear-cat/page.mdx`

Your page must be just as rich (~700–900 lines). Explanations are in **Chinese**; examples
are in English.

## STEP 3 — Answer keys

For all 12 textbook MCQs and every quiz you build, determine the correct answer by close
reading of the passage + grammar/vocabulary rules (these are standard NCE3 items with
canonical answers). For every question write a concise **Chinese** `explainWrong` that says
why the key is right and why each distractor is wrong, citing passage lines where relevant.

## STEP 4 — Write the page

File skeleton (keep blank lines around block-level components and headings):

```mdx
<Lesson textbook="new-concept-english-3" slug="{SLUG}">

<Callout type="info" title="Listen first 听前思考">
  中文导读，营造悬念 + 抛出课文开头那道 “Listen to the tape then answer the question” 的问题（中英）。
</Callout>

## The Text 课文

逐段转写课文为正文。用 **...** 把本课要重点学习的 6–10 个结构/短语加粗（这里是 MDX 正文，**...** 会渲染成粗体）。

### Listen and shadow 听音跟读

挑 3 句最值得跟读的，每句一个：
<SayIt text="A sentence from the passage." />

（可选）### 对话回放 / 想一想
若课文是叙事，可加一个 <ChatDialog .../> 把情节“演”出来；若是说明文，可省略，或用一个 Callout 抛个思考问题。

## 课文注释 Notes on the text

<Callout type="info" title="N 个值得停下来嚼一嚼的点">
  把 Notes 用中文逐条讲清：点出短语/语法点 + 给同型例句。
</Callout>

## 参考译文 Chinese reference

<Callout type="tip" title="先读原文，遇到读不懂的句子再回来对照">
  参考译文（分段）。
</Callout>

## 1. 核心词汇速记 Vocabulary flashcards

<FlashcardDeck title="High-yield vocabulary" layout="grid" cards={[
  { front: { text: "word", caption: "/ˈwɜːd/ · n." }, back: { text: "中文释义", caption: "课文例句" } },
  // ~10 张，覆盖生词表里最重要的词
]} />

## 2. 阅读理解 Reading comprehension

<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="comprehension" questions={[
  // 教材 3 道 Comprehension 改写成单选 + 你补 2 道深度题
]} />

## 3. 关键句型 ...（本课语法重点：取自 Structure 4 题 + Key structures 改写题）

<Callout type="tip" title="一分钟回顾">
  讲清本课核心语法，可用 markdown 表格；附 ⚠️ 易错雷区。
</Callout>

<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="grammar" questions={[ /* 教材 Structure 4 题 + 补充 */ ]} />

### 判一判 Spot the broken

<SpotTheBroken textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="grammar-spot" title="句子站得住吗？" items={[
  { id: "b1", text: "A correct sentence.", isCorrect: true },
  { id: "b2", text: "A broken sentence.", isCorrect: false, fix: "中文：为什么错 + 正确写法。" },
  // 8–10 句，围绕本课语法
]} />

## 4. 难点：... Special difficulties

<Callout type="info" title="...">本课难点讲解。</Callout>
<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="difficulties" questions={[ /* ... */ ]} />

## 5. 高价值短语：中→英 Match

<Match textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="phrase-match" title="中文场景 → 英文表达" pairs={[
  { id: "p1", left: "中文", right: "English phrase" },
  // ~10 对，取自课文
]} />

## 6. 整句翻译 Sentence translation

<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="translation" questions={[
  // ~8 题：中文句 → 4 个英译选项，answer 用课文原句，干扰项是常见错误
]} />

## 7. 同义替换 Synonyms in context

<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="synonyms" questions={[ /* 取自 Vocabulary 词表 + 4 道 Vocabulary MCQ */ ]} />

## 8. 多项选择 Structure & Vocabulary

直接采纳教材原题：
<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="textbook-mcq" questions={[ /* 全部 12 道教材原题，id 用 m1..m12 */ ]} />

## 9. 关键句默译 Sentence recall

<FlashcardDeck title="Key sentences — translate then flip" layout="grid" cardClassName="h-80" cards={[
  // 5 张：front = 中文（JSX <div>），back = 英文 + 小注（JSX <div>）。照抄参考课 §9 的写法。
]} />

## 10. 摘要写作 Summary writing

<Callout type="info" title="任务">教材摘要任务 + 提示点。</Callout>
<Callout type="tip" title="参考范文（自己写完再看）">你写的范文（不超过词数限制）。</Callout>

## 11. 作文 Composition

<Callout type="info" title="任务">教材作文任务。</Callout>
<Callout type="warning" title="提示骨架">分点骨架。</Callout>
<Callout type="tip" title="写作脚手架">词库 / 时态主线 / 结构亮点。</Callout>
<Callout type="tip" title="参考范文（自己写完再看）">范文。</Callout>

## 12. 书信写作 Letter writing   ← 仅当本课教材有 Letter writing 时才写这一节

<Callout type="info" title="任务">任务。</Callout>
<Callout type="tip" title="写作脚手架">脚手架。</Callout>
<Callout type="tip" title="参考范文（自己写完再看）">范文。</Callout>

## 13. 拓展练习 Going further

<Callout type="tip" title="自学者建议">
  影子跟读 / 复述 / 造句迁移（5 个本课结构）/ 延伸思考。
</Callout>

</Lesson>
```

Adapt sections 3 & 4 to the grammar this lesson actually drills (infer from the Structure
MCQs + the Key-structures/Special-difficulties task). Renumber sections cleanly if you drop
the Letter-writing section.

### Component props (exact)

- `<Lesson textbook="new-concept-english-3" slug="{SLUG}"> ... </Lesson>` — wraps everything.
- `<Callout type="info|tip|warning" title="...">` — children are MDX (markdown renders).
- `<SayIt text="English sentence" />`
- `<ChatDialog title="..." participants={[{ name, emoji, side: "left"|"right", tone: "brand"|"slate"|"rose"|"sky"|"emerald" }]} turns={[{ speaker: "<name>", text: "..." }]} />` — `speaker` must equal a participant `name`.
- `<FlashcardDeck title="..." layout="grid" cards={[{ front, back }]} />` — `front`/`back` are
  either `{ text, caption, emoji?, image? }` objects OR JSX nodes (see ref §9). Optional `cardClassName`.
- `<Quiz textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="unique" questions={[{ id, prompt, choices: ["A","B","C","D"], answer: "<exact text of the correct choice>", explainWrong: "中文解析" }]} />`
- `<Match textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="unique" title="..." pairs={[{ id, left, right }]} />`
- `<SpotTheBroken textbookSlug="new-concept-english-3" lessonSlug="{SLUG}" id="unique" title="..." items={[{ id, text, isCorrect: true|false, fix: "中文（仅 broken 句需要）" }]} />`

### CRITICAL MDX/JSX rules (these cause build failures — follow exactly)

1. **Two contexts.** (a) MDX prose & Callout children → markdown renders: `**bold**`,
   `*italic*`, tables, lists all work. (b) Inside any `{ ... }` prop value → it is
   **JavaScript**; strings are JS string literals.
2. **Quotes inside double-quoted JS strings must be escaped** as `\"`. Better: use full-width
   Chinese quotes `“ ”` and `‘ ’` for Chinese text so you never need to escape. The recurring
   build break in this repo is an unescaped `"` inside a double-quoted `explainWrong`/`fix`.
3. **Apostrophes** (`one's`, `don't`, `o'clock`, `Rastus'`) are FINE inside double-quoted
   strings — do not escape them. Always use **double quotes** (not single) for any prop string
   that contains an apostrophe.
4. To match house style you MAY use `**term**` inside `explainWrong`/`fix` strings for
   emphasis (it shows literally — that is the existing convention; stay consistent with the ref).
5. In MDX prose never write a raw `{`, `}`, or a `<` that is not a real component tag. Spell
   out "less than" etc. `&`, `£`, `%`, `#`, `’` in prose are fine.
6. `answer` must be **character-for-character identical** to one of that question's `choices`.
7. Every Quiz / Match / SpotTheBroken needs a `id` unique within the file, plus
   `textbookSlug` + `lessonSlug` so scores save.
8. Keep blank lines between block-level components and markdown headings.

## STEP 5 — Verify it compiles

From the repo root run:

```
node scripts/mdxcheck.mjs "app/textbooks/new-concept-english-3/{SLUG}/page.mdx"
```

It must print `OK`. If it prints `FAIL`, read the reported line/column, fix it (almost always
an unescaped `"` in a double-quoted string, or a stray `{` / `<` in prose), and re-run until
it prints `OK`.

## Report back

Reply with a short summary: the lesson title, the correct-answer letters for the 12 textbook
MCQs (e.g. `1b 2b 3d 4b | 5c 6a 7d 8a | 9c 10b 11c 12a`), the final line count, and
`compiles: OK`.
