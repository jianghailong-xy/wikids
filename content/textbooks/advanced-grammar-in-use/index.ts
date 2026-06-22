import type { Textbook } from "@/lib/content/types";

// Table of contents follows Advanced Grammar in Use (Martin Hewings,
// Cambridge): 100 two-page units in 14 sections. This is the third book in
// the Cambridge "in Use" grammar series — after Essential Grammar in Use
// (elementary "red") and English Grammar in Use (intermediate "blue").

const textbook: Textbook = {
  slug: "advanced-grammar-in-use",
  title: "Advanced Grammar in Use",
  description:
    "Martin Hewings' advanced grammar reference and practice book — the third in the Cambridge 'in Use' series, after Essential and English Grammar in Use. 100 two-page units pairing a clear explanation with practice, covering tense and aspect, modals, the passive, reporting, relative and participle clauses, articles and quantifiers, adjectives and adverbs, conjunctions, prepositions, and ways of organising information.",
  subject: "English",
  gradeLevel: "Advanced",
  lessons: [
    // ── Tenses ────────────────────────────────────────────────────────
    {
      slug: "01-present-continuous-and-simple-1",
      title: "Present continuous and present simple 1",
      description:
        "I'm doing for activities in progress, temporary or changing; I do for permanent situations, habits and facts — and the state verbs that resist the -ing form.",
      estimatedMinutes: 30,
    },
    {
      slug: "02-present-continuous-and-simple-2",
      title: "Present continuous and present simple 2",
      description:
        "State verbs that take the continuous with a shift of meaning (think, have, see, taste, appear), always/forever + continuous for complaints, and the present in commentaries, instructions and narratives.",
      estimatedMinutes: 30,
    },
    {
      slug: "03-past-simple-and-present-perfect",
      title: "Past simple and present perfect",
      description:
        "Finished time vs time up to now — and how the time reference, not the event, decides which you choose.",
      estimatedMinutes: 30,
    },
    {
      slug: "04-past-continuous-and-past-simple",
      title: "Past continuous and past simple",
      description:
        "Background and interrupted actions (was doing) against completed ones (did) — and repeated or gradually-developing past situations.",
      estimatedMinutes: 30,
    },
    {
      slug: "05-past-perfect-and-past-simple",
      title: "Past perfect and past simple",
      description:
        "had done for the earlier of two past events — when it's needed for clarity and when the past simple alone is enough.",
      estimatedMinutes: 30,
    },
    {
      slug: "06-present-perfect-continuous-and-present-perfect",
      title: "Present perfect continuous and present perfect",
      description:
        "The activity and its duration (have been doing) vs the result or completion (have done) — how long against how much/how many.",
      estimatedMinutes: 30,
    },
    {
      slug: "07-past-perfect-continuous-past-perfect-past-continuous",
      title: "Past perfect continuous, past perfect and past continuous",
      description:
        "Choosing between had been doing, had done and was doing to set events in order before another point in the past.",
      estimatedMinutes: 30,
    },
    {
      slug: "08-present-and-past-time-review",
      title: "Present and past time: review",
      description:
        "Pulling the tense and aspect system together — a review of how present and past, simple and continuous, perfect and non-perfect interact.",
      estimatedMinutes: 30,
    },

    // ── The future ────────────────────────────────────────────────────
    {
      slug: "09-will-and-be-going-to",
      title: "Will and be going to",
      description:
        "Decisions made now and predictions with no present evidence (will) vs intentions already formed and predictions based on what you can see (going to).",
      estimatedMinutes: 30,
    },
    {
      slug: "10-present-simple-and-continuous-for-future",
      title: "Present simple and present continuous for the future",
      description:
        "Timetabled, scheduled events (the train leaves at six) vs personal arrangements already fixed (I'm meeting Sam tomorrow).",
      estimatedMinutes: 30,
    },
    {
      slug: "11-future-continuous-and-future-perfect",
      title: "Future continuous and future perfect (continuous)",
      description:
        "will be doing for something in progress at a future time, and will have done / will have been doing for what will be complete or ongoing by then.",
      estimatedMinutes: 30,
    },
    {
      slug: "12-be-to-and-be-about-to",
      title: "Be to + infinitive; be about to + infinitive",
      description:
        "be to for official arrangements, orders and instructions (no one is to leave), and be about to / be on the point of for the immediate future.",
      estimatedMinutes: 30,
    },
    {
      slug: "13-other-ways-of-talking-about-the-future",
      title: "Other ways of talking about the future",
      description:
        "be due to, be set to, be bound to, be likely to, be on the verge of — plus hope, expect, intend, plan and propose with their patterns.",
      estimatedMinutes: 30,
    },
    {
      slug: "14-the-future-seen-from-the-past",
      title: "The future seen from the past",
      description:
        "was going to, would, was to (have) and was about to for the future imagined from a point in the past — and for plans that didn't happen.",
      estimatedMinutes: 30,
    },

    // ── Modals and semi-modals ────────────────────────────────────────
    {
      slug: "15-can-could-be-able-to-be-allowed-to",
      title: "Can, could, be able to and be allowed to",
      description:
        "Ability, possibility and permission across time — and where be able to and be allowed to fill the gaps that can and could leave.",
      estimatedMinutes: 30,
    },
    {
      slug: "16-will-would-and-used-to",
      title: "Will, would and used to",
      description:
        "will/would for willingness, characteristic behaviour and refusals, and would vs used to for past habits and states.",
      estimatedMinutes: 30,
    },
    {
      slug: "17-may-and-might",
      title: "May and might",
      description:
        "Present and future possibility, permission, may/might have done for the past, and may/might for concession (it may be cheap, but ...).",
      estimatedMinutes: 30,
    },
    {
      slug: "18-must-and-have-got-to",
      title: "Must and have (got) to",
      description:
        "Obligation and necessity from the speaker (must) vs from outside (have to / have got to) — and must / have to for logical conclusions.",
      estimatedMinutes: 30,
    },
    {
      slug: "19-neednt-dont-need-to-dont-have-to",
      title: "Need(n't), don't need to and don't have to",
      description:
        "Saying something isn't necessary — and the crucial difference between needn't have done and didn't need to do.",
      estimatedMinutes: 30,
    },
    {
      slug: "20-should-ought-to-and-had-better",
      title: "Should, ought to and had better",
      description:
        "Advice, expectation and mild obligation (should / ought to), should have done for criticism and regret, and the sharper had better.",
      estimatedMinutes: 30,
    },

    // ── Linking verbs, passives, questions ────────────────────────────
    {
      slug: "21-linking-verbs-be-appear-seem-become-get",
      title: "Linking verbs: be, appear, seem; become, get, etc.",
      description:
        "Verbs that link a subject to a complement — be, appear, seem, look, become, get, grow, turn — and what can follow them.",
      estimatedMinutes: 30,
    },
    {
      slug: "22-forming-passive-sentences-1",
      title: "Forming passive sentences 1",
      description:
        "be + past participle across the tenses, when the passive is preferred, and choosing whether to include the agent with by.",
      estimatedMinutes: 30,
    },
    {
      slug: "23-forming-passive-sentences-2-ing-or-to-infinitive",
      title: "Forming passive sentences 2: verb + -ing or to-infinitive",
      description:
        "Passive forms after verbs taking -ing or the infinitive — being done, to be done, having been done, and want/like something done.",
      estimatedMinutes: 30,
    },
    {
      slug: "24-using-passives",
      title: "Using passives",
      description:
        "Why writers choose the passive — keeping the topic in subject position, managing given and new information, and the get-passive.",
      estimatedMinutes: 30,
    },
    {
      slug: "25-reporting-with-passives-it-is-said-that",
      title: "Reporting with passives; It is said that ...",
      description:
        "Impersonal reporting — it is said/believed/thought that ... and he is said/known/expected to ... — for distance and objectivity.",
      estimatedMinutes: 30,
    },
    {
      slug: "26-wh-questions-who-whom-which-how-whose",
      title: "Wh-questions with who, whom, which, how and whose",
      description:
        "Subject vs object questions, the formal whom, questions with whose and how, and prepositions in wh-questions.",
      estimatedMinutes: 30,
    },
    {
      slug: "27-negative-questions-echo-questions-that-clauses",
      title: "Negative questions; echo questions; questions with that-clauses",
      description:
        "Negative questions for surprise and persuasion (Don't you agree?), echo questions that check back, and Do you think (that) ...?",
      estimatedMinutes: 30,
    },

    // ── Verb complementation: what follows verbs ──────────────────────
    {
      slug: "28-verbs-objects-and-complements",
      title: "Verbs, objects and complements",
      description:
        "Transitive and intransitive verbs, verbs that take an object plus a complement, and verbs that work both ways.",
      estimatedMinutes: 30,
    },
    {
      slug: "29-verb-plus-two-objects",
      title: "Verb + two objects",
      description:
        "Indirect and direct objects (give her the book / give the book to her) — word order and the to / for split.",
      estimatedMinutes: 30,
    },
    {
      slug: "30-verb-plus-ing-forms-and-infinitives-1",
      title: "Verb + -ing forms and infinitives 1",
      description:
        "Verbs followed by -ing or to with the same or a different meaning — remember, forget, regret, go on, mean, stop, try.",
      estimatedMinutes: 30,
    },
    {
      slug: "31-verb-plus-ing-forms-and-infinitives-2",
      title: "Verb + -ing forms and infinitives 2",
      description:
        "Verbs that need an object before a to-infinitive (warn, persuade) versus those that don't (decide, hope); preposition + object + to-infinitive (arrange for, depend on, appeal to); plus negative infinitives and to have / having + past participle.",
      estimatedMinutes: 30,
    },

    // ── Reporting ─────────────────────────────────────────────────────
    {
      slug: "32-reporting-peoples-words-and-thoughts",
      title: "Reporting people's words and thoughts",
      description:
        "Direct vs reported speech, the range of reporting verbs, and how faithfully you have to stick to the original words.",
      estimatedMinutes: 30,
    },
    {
      slug: "33-reporting-statements-that-clauses",
      title: "Reporting statements: that-clauses",
      description:
        "Backshifting tenses in the that-clause, when the original tense is kept, and reporting things that are still true.",
      estimatedMinutes: 30,
    },
    {
      slug: "34-verb-plus-wh-clause",
      title: "Verb + wh-clause",
      description:
        "Reporting questions and uncertainties with wh- and whether/if clauses — I asked where, I don't know whether.",
      estimatedMinutes: 30,
    },
    {
      slug: "35-tense-choice-in-reporting",
      title: "Tense choice in reporting",
      description:
        "How a present or past reporting verb, and the time you're reporting from, shape the tense in the reported clause.",
      estimatedMinutes: 30,
    },
    {
      slug: "36-reporting-offers-suggestions-orders-intentions",
      title: "Reporting offers, suggestions, orders, intentions, etc.",
      description:
        "Reporting verbs with their patterns — offer/promise to do, suggest doing / that, advise/order somebody to do, insist on.",
      estimatedMinutes: 30,
    },
    {
      slug: "37-modal-verbs-in-reporting",
      title: "Modal verbs in reporting",
      description:
        "How will, can, may, must, shall and should change — or stay the same — when you report them.",
      estimatedMinutes: 30,
    },
    {
      slug: "38-reporting-using-nouns-and-adjectives",
      title: "Reporting what people say using nouns and adjectives",
      description:
        "Reporting with a noun or adjective + that-clause or to-infinitive — his belief that ..., she was adamant that ..., we were keen to ...",
      estimatedMinutes: 30,
    },
    {
      slug: "39-should-in-that-clauses-present-subjunctive",
      title: "Should in that-clauses; the present subjunctive",
      description:
        "should or the bare subjunctive after suggest, demand, insist and after it's important/essential that — I insist that he be told.",
      estimatedMinutes: 30,
    },

    // ── Nouns ─────────────────────────────────────────────────────────
    {
      slug: "40-agreement-between-subject-and-verb-1",
      title: "Agreement between subject and verb 1",
      description:
        "Making the verb agree — collective nouns (team, government), nouns that look plural, and titles or quantities treated as singular.",
      estimatedMinutes: 30,
    },
    {
      slug: "41-agreement-between-subject-and-verb-2",
      title: "Agreement between subject and verb 2",
      description:
        "Agreement with quantifiers, fractions and amounts — a number of are vs the number of is, half of, the majority of.",
      estimatedMinutes: 30,
    },
    {
      slug: "42-agreement-between-subject-and-verb-3",
      title: "Agreement between subject and verb 3",
      description:
        "Plural-only nouns (earnings, outskirts, premises); data/media and criteria/phenomena; -s subjects that are singular (news, economics, measles); and agreement with measurements, percentages and fractions.",
      estimatedMinutes: 30,
    },
    {
      slug: "43-compound-nouns-and-noun-phrases",
      title: "Compound nouns and noun phrases",
      description:
        "Building noun + noun combinations and longer noun phrases — when to use 's, of, or a hyphen, and how the parts are ordered.",
      estimatedMinutes: 30,
    },

    // ── Articles, determiners and quantifiers ─────────────────────────
    {
      slug: "44-a-an-and-one",
      title: "A / an and one",
      description:
        "Where a/an and one overlap and where they don't — one for emphasis, contrast or precise number against the neutral a/an.",
      estimatedMinutes: 30,
    },
    {
      slug: "45-a-an-the-and-zero-article-1",
      title: "A / an, the and zero article 1",
      description:
        "Talking about things in general — a/an, the and no article for generic reference, and which is natural where.",
      estimatedMinutes: 30,
    },
    {
      slug: "46-a-an-the-and-zero-article-2",
      title: "A / an, the and zero article 2",
      description:
        "Specific and known reference — when the marks something as identifiable, and how first and later mentions work.",
      estimatedMinutes: 30,
    },
    {
      slug: "47-a-an-the-and-zero-article-3",
      title: "A / an, the and zero article 3",
      description:
        "Articles with names, institutions, meals, transport and fixed phrases — go to school vs go to the school, by car, in hospital.",
      estimatedMinutes: 30,
    },
    {
      slug: "48-some-and-any",
      title: "Some and any",
      description:
        "some and any beyond the positive/question rule — offers and requests with some, any meaning 'it doesn't matter which', and the compounds.",
      estimatedMinutes: 30,
    },
    {
      slug: "49-no-none-of-and-not-any",
      title: "No, none (of) and not any",
      description:
        "Expressing zero quantity — no + noun, none (of) on its own, not any, and avoiding the double negative.",
      estimatedMinutes: 30,
    },
    {
      slug: "50-much-many-a-lot-of-lots-of",
      title: "Much (of), many (of), a lot of, lots (of), etc.",
      description:
        "Large quantities with countable and uncountable nouns — much/many vs a lot of/lots of, and the of forms before the/this/them.",
      estimatedMinutes: 30,
    },
    {
      slug: "51-all-of-whole-every-each",
      title: "All (of), whole, every, each",
      description:
        "Talking about totality — all (of) vs the whole, every vs each, all day vs every day, and where each can go in a sentence.",
      estimatedMinutes: 30,
    },
    {
      slug: "52-few-little-less-fewer",
      title: "Few, little, less, fewer",
      description:
        "Small and reducing quantities — the meaning gap between few/little and a few/a little, and less vs fewer.",
      estimatedMinutes: 30,
    },

    // ── Relative clauses and other types of clause ────────────────────
    {
      slug: "53-relative-pronouns",
      title: "Relative pronouns",
      description:
        "who, whom, which, that, whose and the zero relative — defining vs non-defining clauses and when you can leave the pronoun out.",
      estimatedMinutes: 30,
    },
    {
      slug: "54-other-relative-words-whose-when-whereby",
      title: "Other relative words: whose, when, whereby, etc.",
      description:
        "Relating with whose, when, where, why and the formal whereby — and adding information about a whole clause with which.",
      estimatedMinutes: 30,
    },
    {
      slug: "55-prepositions-in-relative-clauses",
      title: "Prepositions in relative clauses",
      description:
        "the man to whom I spoke vs the man I spoke to — fronting the preposition for a formal style or leaving it at the end.",
      estimatedMinutes: 30,
    },
    {
      slug: "56-adding-information-to-noun-phrases-1",
      title: "Other ways of adding information to noun phrases 1: additional noun phrases, etc.",
      description:
        "Apposition — placing a second noun phrase beside the first to define or describe it (my brother, a doctor, lives nearby).",
      estimatedMinutes: 30,
    },
    {
      slug: "57-adding-information-to-noun-phrases-2",
      title: "Other ways of adding information to noun phrases 2: prepositional phrases, etc.",
      description:
        "Post-modifying a noun with a prepositional phrase or adjective phrase instead of a full relative clause.",
      estimatedMinutes: 30,
    },
    {
      slug: "58-participle-clauses-with-adverbial-meaning-1",
      title: "Participle clauses with adverbial meaning 1",
      description:
        "-ing and -ed clauses standing in for an adverbial clause of time, reason or result — feeling tired, she went to bed.",
      estimatedMinutes: 30,
    },
    {
      slug: "59-participle-clauses-with-adverbial-meaning-2",
      title: "Participle clauses with adverbial meaning 2",
      description:
        "More participle clauses — having done, with + noun + participle, and conjunctions before a participle (when reading, although knowing).",
      estimatedMinutes: 30,
    },

    // ── Pronouns, substitution and leaving out words ──────────────────
    {
      slug: "60-reflexive-pronouns",
      title: "Reflexive pronouns: herself, himself, themselves, etc.",
      description:
        "Reflexive pronouns when subject and object are the same, the emphatic use (I did it myself), and reflexive vs each other.",
      estimatedMinutes: 30,
    },
    {
      slug: "61-one-and-ones",
      title: "One and ones",
      description:
        "Using one and ones to avoid repeating a countable noun — the red one, the ones on the table — and where you can't.",
      estimatedMinutes: 30,
    },
    {
      slug: "62-so-and-not-as-substitutes",
      title: "So and not as substitutes for clauses, etc.",
      description:
        "Standing in for a whole clause with so and not — I think so, I'm afraid not, if so, and I told you so.",
      estimatedMinutes: 30,
    },
    {
      slug: "63-do-so-such",
      title: "Do so; such",
      description:
        "Replacing a verb phrase with do so / do it / do that, and pointing back to something with such and such a.",
      estimatedMinutes: 30,
    },
    {
      slug: "64-leaving-out-words-after-auxiliary-verbs",
      title: "More on leaving out words after auxiliary verbs",
      description:
        "Ellipsis after an auxiliary — I haven't finished but she has — and reduced forms in answers and after and/but/or.",
      estimatedMinutes: 30,
    },
    {
      slug: "65-leaving-out-to-infinitives",
      title: "Leaving out to-infinitives",
      description:
        "Keeping just to and dropping the rest of the infinitive — I'd love to, you can go if you want to, I meant to.",
      estimatedMinutes: 30,
    },

    // ── Adjectives and adverbs ────────────────────────────────────────
    {
      slug: "66-position-of-adjectives",
      title: "Position of adjectives",
      description:
        "Attributive vs predicative position — adjectives that go only before the noun, only after a linking verb, or after the noun.",
      estimatedMinutes: 30,
    },
    {
      slug: "67-gradable-and-non-gradable-adjectives-1",
      title: "Gradable and non-gradable adjectives 1",
      description:
        "Gradable adjectives with very/rather and non-gradable (absolute, extreme, classifying) ones with absolutely/completely.",
      estimatedMinutes: 30,
    },
    {
      slug: "68-gradable-and-non-gradable-adjectives-2",
      title: "Gradable and non-gradable adjectives 2",
      description:
        "Matching intensifiers to adjectives — utterly, totally, highly, perfectly — and adjectives that can be both gradable and non-gradable.",
      estimatedMinutes: 30,
    },
    {
      slug: "69-participle-adjectives-and-compound-adjectives",
      title: "Participle adjectives and compound adjectives",
      description:
        "-ing vs -ed adjectives (exciting/excited) and compound adjectives — well-known, hard-working, a five-year-old child.",
      estimatedMinutes: 30,
    },
    {
      slug: "70-adjectives-plus-to-infinitive-ing-that-wh",
      title: "Adjectives + to-infinitive, -ing, that-clause, wh-clause",
      description:
        "What can follow an adjective — keen to go, busy doing, sure that ..., not certain whether ... — and which pattern each takes.",
      estimatedMinutes: 30,
    },
    {
      slug: "71-adjectives-and-adverbs",
      title: "Adjectives and adverbs",
      description:
        "Form and function — adverbs from adjectives, adjectives and adverbs with the same form (fast, hard, late), and good vs well.",
      estimatedMinutes: 30,
    },
    {
      slug: "72-comparative-and-superlative-forms",
      title: "Adjectives and adverbs: comparative and superlative forms",
      description:
        "Forming comparatives and superlatives — -er/-est vs more/most, the irregulars, and comparative/superlative adverbs.",
      estimatedMinutes: 30,
    },
    {
      slug: "73-comparative-phrases-and-clauses",
      title: "Comparative phrases and clauses",
      description:
        "than and as ... as, strengthening with much/far/a lot, the ... the ..., and more and more for gradual change.",
      estimatedMinutes: 30,
    },
    {
      slug: "74-position-of-adverbs-1",
      title: "Position of adverbs 1",
      description:
        "Front, mid and end position — where adverbs of manner, place and time go, and the order when several come together.",
      estimatedMinutes: 30,
    },
    {
      slug: "75-position-of-adverbs-2",
      title: "Position of adverbs 2",
      description:
        "Mid-position adverbs around the verb and auxiliaries, and how position can change the emphasis or the meaning.",
      estimatedMinutes: 30,
    },
    {
      slug: "76-adverbs-of-place-direction-frequency-time",
      title: "Adverbs of place, direction, indefinite frequency, and time",
      description:
        "Placing here/there, up/down, usually/often/rarely, and already/still/yet — and what they tell you about when and how often.",
      estimatedMinutes: 30,
    },
    {
      slug: "77-degree-adverbs-and-focus-adverbs",
      title: "Degree adverbs and focus adverbs",
      description:
        "Degree adverbs that scale (very, quite, slightly, almost) and focus adverbs that single something out (only, even, just, also).",
      estimatedMinutes: 30,
    },
    {
      slug: "78-comment-adverbs-and-viewpoint-adverbs",
      title: "Comment adverbs and viewpoint adverbs",
      description:
        "Commenting on a whole statement (frankly, apparently, surprisingly) and limiting it to a point of view (financially, technically).",
      estimatedMinutes: 30,
    },

    // ── Adverbial clauses and conjunctions ────────────────────────────
    {
      slug: "79-adverbial-clauses-of-time",
      title: "Adverbial clauses of time",
      description:
        "when, while, as, before, after, until, since, once — and the present (not will) for future time after them.",
      estimatedMinutes: 30,
    },
    {
      slug: "80-giving-reasons-as-because-for-with",
      title: "Giving reasons: as, because, etc.; for and with",
      description:
        "Reason clauses with because, as, since, seeing that — and giving a reason with for and with + noun phrase.",
      estimatedMinutes: 30,
    },
    {
      slug: "81-purposes-and-results-in-order-to-so-as-to",
      title: "Purposes and results: in order to, so as to, etc.",
      description:
        "Purpose with to, in order to, so as to, so that, in case — and result with so ... that and such ... that.",
      estimatedMinutes: 30,
    },
    {
      slug: "82-contrasts-although-though-while-whereas",
      title: "Contrasts: although and though; even though / if; while, whilst and whereas",
      description:
        "Concession and contrast — although/though/even though, end-position though, and while/whilst/whereas for direct contrast.",
      estimatedMinutes: 30,
    },
    {
      slug: "83-if-1",
      title: "If 1",
      description:
        "Real conditions — likely or possible situations and their results, the present tense after if, and if vs when.",
      estimatedMinutes: 30,
    },
    {
      slug: "84-if-2",
      title: "If 2",
      description:
        "Unreal and past conditions — if + past / would, if + past perfect / would have, and mixed conditionals.",
      estimatedMinutes: 30,
    },
    {
      slug: "85-if-i-were-you-imagine-he-were-to-win",
      title: "If I were you ...; imagine he were to win",
      description:
        "were instead of was in unreal conditions, if ... were to and should for tentative or unlikely possibilities, and suppose/imagine/what if.",
      estimatedMinutes: 30,
    },
    {
      slug: "86-if-not-and-unless-if-and-whether",
      title: "If ... not and unless; if and whether; etc.",
      description:
        "unless = if ... not (and where they differ), if/whether in reported questions, and if so / if not / even if.",
      estimatedMinutes: 30,
    },
    {
      slug: "87-connecting-ideas-in-and-between-sentences",
      title: "Connecting ideas in a sentence and between sentences",
      description:
        "Linking words and conjuncts that join clauses and sentences — however, therefore, on the other hand, in addition, as a result.",
      estimatedMinutes: 30,
    },

    // ── Prepositions ──────────────────────────────────────────────────
    {
      slug: "88-prepositions-of-position-and-movement",
      title: "Prepositions of position and movement",
      description:
        "at/on/in for position and to/into/onto/towards for movement — and pairs that are easily confused.",
      estimatedMinutes: 30,
    },
    {
      slug: "89-between-and-among",
      title: "Between and among",
      description:
        "between for two (or several seen separately) and among for a group seen as a mass — plus the set phrases each takes.",
      estimatedMinutes: 30,
    },
    {
      slug: "90-prepositions-of-time",
      title: "Prepositions of time",
      description:
        "at/on/in for points and periods, by vs until for deadlines and duration, and during/for/over/throughout.",
      estimatedMinutes: 30,
    },
    {
      slug: "91-talking-about-exceptions",
      title: "Talking about exceptions",
      description:
        "Marking what's left out — except (for), apart from, but for, besides, other than — and how they differ.",
      estimatedMinutes: 30,
    },
    {
      slug: "92-prepositions-after-verbs",
      title: "Prepositions after verbs",
      description:
        "Verb + preposition patterns — the preposition each verb locks onto, and verb + object + preposition.",
      estimatedMinutes: 30,
    },
    {
      slug: "93-prepositions-after-nouns",
      title: "Prepositions after nouns",
      description:
        "The preposition that follows particular nouns — a reason for, an increase in, the effect on, a relationship with.",
      estimatedMinutes: 30,
    },
    {
      slug: "94-two-and-three-word-verbs-word-order",
      title: "Two- and three-word verbs: word order",
      description:
        "Phrasal, prepositional and phrasal-prepositional verbs — which take an object, where the object goes, and which are separable.",
      estimatedMinutes: 30,
    },

    // ── Organising information ────────────────────────────────────────
    {
      slug: "95-there-is-there-was",
      title: "There is, there was, etc.",
      description:
        "Introducing something new with there + be, agreement with what follows, and there with other verbs (there appears to be).",
      estimatedMinutes: 30,
    },
    {
      slug: "96-it-1",
      title: "It 1",
      description:
        "Preparatory it standing in for a later subject or object — it's no use crying, I find it hard to believe.",
      estimatedMinutes: 30,
    },
    {
      slug: "97-it-2",
      title: "It 2",
      description:
        "More it patterns — it for situations, time, weather and distance, and it + passive reporting verb (it is thought that).",
      estimatedMinutes: 30,
    },
    {
      slug: "98-focusing-it-clauses-and-what-clauses",
      title: "Focusing: it-clauses and what-clauses",
      description:
        "Cleft sentences for emphasis — It was Tom who ... and What I need is ... — to put the spotlight on one part of a sentence.",
      estimatedMinutes: 30,
    },
    {
      slug: "99-inversion-1",
      title: "Inversion 1",
      description:
        "The two kinds of inversion and fronting — Here comes ..., in came the doctor, conditionals without if (Were ..., Should ..., Had ...), and inversion after as and than.",
      estimatedMinutes: 30,
    },
    {
      slug: "100-inversion-2",
      title: "Inversion 2",
      description:
        "More inversion — after so/such and neither/nor, in conditionals without if (Had I known ...), and after fronted place adverbials.",
      estimatedMinutes: 30,
    },
  ],
};

export default textbook;
