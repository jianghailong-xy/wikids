import type { Textbook } from "@/lib/content/types";

// Table of contents follows the 5th edition of English Grammar in Use
// (Raymond Murphy, intermediate "blue" book): 145 units in 16 sections.

const textbook: Textbook = {
  slug: "english-grammar-in-use",
  title: "English Grammar in Use",
  description:
    "Raymond Murphy's classic blue intermediate grammar — the sequel to Essential Grammar in Use. 145 two-page units, each pairing a clear explanation with plenty of practice, covering tenses, modals, the passive, relative clauses, articles, prepositions, and phrasal verbs.",
  subject: "English",
  gradeLevel: "Intermediate",
  series: "Grammar in Use",
  lessons: [
    // ── Present and past ──────────────────────────────────────────────
    {
      slug: "01-present-continuous",
      title: "Present continuous (I am doing)",
      description:
        "am/is/are + -ing for what's happening right now, around now, or a changing situation — and the spelling of the -ing form.",
      estimatedMinutes: 25,
    },
    {
      slug: "02-present-simple",
      title: "Present simple (I do)",
      description:
        "The plain form for things in general, habits, and facts that are always true — plus the he/she/it -s and questions/negatives with do/does.",
      estimatedMinutes: 25,
    },
    {
      slug: "03-present-continuous-vs-simple-1",
      title: "Present continuous and present simple 1 (I am doing and I do)",
      description:
        "Now vs in general — and the verbs (like, want, know, mean, understand, prefer) that normally don't take the -ing form.",
      estimatedMinutes: 25,
    },
    {
      slug: "04-present-continuous-vs-simple-2",
      title: "Present continuous and present simple 2 (I am doing and I do)",
      description:
        "More on the two presents: I think vs I'm thinking, he's selfish vs he's being selfish, see/hear with can, and look/feel.",
      estimatedMinutes: 25,
    },
    {
      slug: "05-past-simple",
      title: "Past simple (I did)",
      description:
        "Finished actions at a finished time — regular -ed and the irregular verbs, plus questions and negatives with did.",
      estimatedMinutes: 25,
    },
    {
      slug: "06-past-continuous",
      title: "Past continuous (I was doing)",
      description:
        "was/were + -ing for something in progress at a past moment — and how it frames a shorter past simple action that interrupts it.",
      estimatedMinutes: 25,
    },

    // ── Present perfect and past ──────────────────────────────────────
    {
      slug: "07-present-perfect-1",
      title: "Present perfect 1 (I have done)",
      description:
        "have/has + past participle for a past action with a present result — and gone to vs been to.",
      estimatedMinutes: 25,
    },
    {
      slug: "08-present-perfect-2",
      title: "Present perfect 2 (I have done)",
      description:
        "News and recent events with just, already and yet — and how have you ever ...? talks about your life up to now.",
      estimatedMinutes: 25,
    },
    {
      slug: "09-present-perfect-continuous",
      title: "Present perfect continuous (I have been doing)",
      description:
        "have/has been + -ing for an activity that started in the past and is still going on (or has just stopped) — How long ...?",
      estimatedMinutes: 25,
    },
    {
      slug: "10-present-perfect-continuous-vs-simple",
      title: "Present perfect continuous and simple (I have been doing and I have done)",
      description:
        "The activity vs the result: I've been reading (how long) vs I've read it (finished, how much/how many).",
      estimatedMinutes: 25,
    },
    {
      slug: "11-how-long-have-you-been",
      title: "how long have you (been) ... ?",
      description:
        "Situations that began in the past and continue now — present perfect (not present simple) for I've known / we've lived / it's been raining.",
      estimatedMinutes: 25,
    },
    {
      slug: "12-for-and-since",
      title: "for and since; when ... ? and how long ... ?",
      description:
        "for + a length of time, since + a starting point — and the difference between When did you ...? and How long have you ...?",
      estimatedMinutes: 25,
    },
    {
      slug: "13-present-perfect-vs-past-1",
      title: "Present perfect and past 1 (I have done and I did)",
      description:
        "Unfinished time (today, this week) and present results vs a finished past time — why ago always goes with the past simple.",
      estimatedMinutes: 25,
    },
    {
      slug: "14-present-perfect-vs-past-2",
      title: "Present perfect and past 2 (I have done and I did)",
      description:
        "More contrasts, including British vs American habits, and why a finished time word (yesterday, last year, in 2010) forces the past simple.",
      estimatedMinutes: 25,
    },
    {
      slug: "15-past-perfect",
      title: "Past perfect (I had done)",
      description:
        "had + past participle for the 'past before the past' — the earlier of two past events.",
      estimatedMinutes: 25,
    },
    {
      slug: "16-past-perfect-continuous",
      title: "Past perfect continuous (I had been doing)",
      description:
        "had been + -ing for an activity going on before another past moment — and how long it had been happening.",
      estimatedMinutes: 25,
    },
    {
      slug: "17-have-and-have-got",
      title: "have and have got",
      description:
        "have and have got for possession, relationships and illnesses — plus the questions/negatives and the past (had, not had got).",
      estimatedMinutes: 20,
    },
    {
      slug: "18-used-to",
      title: "used to (do)",
      description:
        "used to + verb for past habits and states that aren't true any more — I used to smoke, there used to be a cinema here.",
      estimatedMinutes: 20,
    },

    // ── Future ────────────────────────────────────────────────────────
    {
      slug: "19-present-tenses-for-future",
      title: "Present tenses (I am doing / I do) for the future",
      description:
        "Present continuous for fixed arrangements (I'm meeting Tom tomorrow) and present simple for timetables (the train leaves at 9).",
      estimatedMinutes: 25,
    },
    {
      slug: "20-going-to",
      title: "I'm going to (do)",
      description:
        "going to for intentions you've already decided on — and for predictions based on what you can see now.",
      estimatedMinutes: 25,
    },
    {
      slug: "21-will-shall-1",
      title: "will and shall 1",
      description:
        "will for decisions made at the moment of speaking, offers, promises and refusals — and the short forms I'll / won't.",
      estimatedMinutes: 25,
    },
    {
      slug: "22-will-shall-2",
      title: "will and shall 2",
      description:
        "will for predictions and opinions about the future — with probably, I expect, I'm sure, I think — and Shall I/we ...?",
      estimatedMinutes: 25,
    },
    {
      slug: "23-will-vs-going-to",
      title: "I will and I'm going to",
      description:
        "The decision test: going to for what you'd already decided, will for what you decide as you speak.",
      estimatedMinutes: 25,
    },
    {
      slug: "24-will-be-doing-will-have-done",
      title: "will be doing and will have done",
      description:
        "Future continuous for something in progress at a future time, and future perfect for something finished by then.",
      estimatedMinutes: 25,
    },
    {
      slug: "25-when-i-do-when-and-if",
      title: "when I do and when I've done; if and when",
      description:
        "Why we use the present (not will) after when, while, before, after, until, as soon as — and the difference between if and when.",
      estimatedMinutes: 25,
    },

    // ── Modals ────────────────────────────────────────────────────────
    {
      slug: "26-can-could-be-able-to",
      title: "can, could and (be) able to",
      description:
        "Ability and possibility now and in the past — and where be able to fills the gaps can/could can't reach.",
      estimatedMinutes: 25,
    },
    {
      slug: "27-could-do-and-could-have-done",
      title: "could (do) and could have (done)",
      description:
        "could for present/future possibility and past unreal ability — and could have done for things that were possible but didn't happen.",
      estimatedMinutes: 25,
    },
    {
      slug: "28-must-and-cant",
      title: "must and can't",
      description:
        "Logical conclusions: must = I'm sure it's true, can't = I'm sure it isn't — plus must/can't have done for the past.",
      estimatedMinutes: 25,
    },
    {
      slug: "29-may-and-might-1",
      title: "may and might 1",
      description:
        "may and might for present and future possibility (it may/might be true) — including the continuous and the negative.",
      estimatedMinutes: 25,
    },
    {
      slug: "30-may-and-might-2",
      title: "may and might 2",
      description:
        "More uses: might as well, may/might have done for past possibility, and may for permission.",
      estimatedMinutes: 25,
    },
    {
      slug: "31-have-to-and-must",
      title: "have to and must",
      description:
        "Obligation: have to for facts and rules, must for the speaker's own feeling — and the all-important didn't have to vs mustn't.",
      estimatedMinutes: 25,
    },
    {
      slug: "32-must-mustnt-neednt",
      title: "must mustn't needn't",
      description:
        "You must (do it), you mustn't (it's forbidden), you needn't (it isn't necessary) — and needn't have done.",
      estimatedMinutes: 25,
    },
    {
      slug: "33-should-1",
      title: "should 1",
      description:
        "should / ought to for advice and what's right — should have done for past regrets, and should after I think/I don't think.",
      estimatedMinutes: 25,
    },
    {
      slug: "34-should-2",
      title: "should 2",
      description:
        "should after suggest, insist, demand, important, essential etc. — and should meaning 'if by chance' (if you should see her ...).",
      estimatedMinutes: 25,
    },
    {
      slug: "35-id-better-its-time",
      title: "I'd better ... it's time ...",
      description:
        "had better for strong advice with a warning attached — and It's time (you did) for something that's overdue.",
      estimatedMinutes: 20,
    },
    {
      slug: "36-would",
      title: "would",
      description:
        "would for imagined situations, past habits (= used to), polite requests, and why we wouldn't do something.",
      estimatedMinutes: 25,
    },
    {
      slug: "37-can-could-would-you",
      title: "can/could/would you ... ? etc. (Requests, offers, permission and invitations)",
      description:
        "The polite toolkit: asking people to do things, asking for and giving permission, offering, and inviting.",
      estimatedMinutes: 25,
    },

    // ── if and wish ───────────────────────────────────────────────────
    {
      slug: "38-if-i-do-and-if-i-did",
      title: "if I do ... and if I did ...",
      description:
        "First vs second conditional: real future possibilities (if it rains) vs imagined or unlikely ones (if I won the lottery).",
      estimatedMinutes: 25,
    },
    {
      slug: "39-if-i-knew-i-wish-i-knew",
      title: "if I knew ... I wish I knew ...",
      description:
        "Unreal present situations: if + past for things that aren't true now, and I wish + past for what you'd like to be different.",
      estimatedMinutes: 25,
    },
    {
      slug: "40-if-i-had-known-i-wish-i-had-known",
      title: "if I had known ... I wish I had known ...",
      description:
        "Third conditional and past regret: if + had done / would have done for the past you can't change.",
      estimatedMinutes: 25,
    },
    {
      slug: "41-wish",
      title: "wish",
      description:
        "All the wishes in one place: I wish I knew, I wish I'd known, I wish you would, and wish vs hope.",
      estimatedMinutes: 25,
    },

    // ── Passive ───────────────────────────────────────────────────────
    {
      slug: "42-passive-1",
      title: "Passive 1 (is done / was done)",
      description:
        "When the action matters more than who does it — be + past participle, and how to add by ... if you need the doer.",
      estimatedMinutes: 25,
    },
    {
      slug: "43-passive-2",
      title: "Passive 2 (be done / been done / being done)",
      description:
        "The passive across every tense and form — including the present perfect, modals, and being done / been done.",
      estimatedMinutes: 25,
    },
    {
      slug: "44-passive-3",
      title: "Passive 3",
      description:
        "Passive with two objects (I was given ...), born, and get + past participle (got broken, got stolen).",
      estimatedMinutes: 25,
    },
    {
      slug: "45-it-is-said-that",
      title: "it is said that ... he is said to ... he is supposed to ...",
      description:
        "Reporting what people say impersonally — it is said that he ... / he is said to ... — and the two meanings of supposed to.",
      estimatedMinutes: 25,
    },
    {
      slug: "46-have-something-done",
      title: "have something done",
      description:
        "Getting someone else to do it for you: I had my hair cut, we're having the house painted — and the 'something unpleasant happened' use.",
      estimatedMinutes: 25,
    },

    // ── Reported speech ───────────────────────────────────────────────
    {
      slug: "47-reported-speech-1",
      title: "Reported speech 1 (he said that ...)",
      description:
        "Backshifting tenses when you report what someone said — and when you don't need to.",
      estimatedMinutes: 25,
    },
    {
      slug: "48-reported-speech-2",
      title: "Reported speech 2",
      description:
        "Reporting questions, requests and orders — tell/ask somebody to do, and say vs tell.",
      estimatedMinutes: 25,
    },

    // ── Questions and auxiliary verbs ─────────────────────────────────
    {
      slug: "49-questions-1",
      title: "Questions 1",
      description:
        "Word order in questions, questions with a preposition at the end, and Who saw you? vs Who did you see?",
      estimatedMinutes: 25,
    },
    {
      slug: "50-questions-2-do-you-know-where",
      title: "Questions 2 (do you know where ... ? / he asked me where ...)",
      description:
        "Embedded questions: Do you know where ...? and reported Where ...? — statement word order, no do/did.",
      estimatedMinutes: 25,
    },
    {
      slug: "51-auxiliary-verbs-i-think-so",
      title: "Auxiliary verbs (have/do/can etc.); I think so / I hope so etc.",
      description:
        "Echoing with auxiliaries (So am I / Neither do I), short answers, and I think so / I hope so / I'm afraid not.",
      estimatedMinutes: 25,
    },
    {
      slug: "52-question-tags",
      title: "Question tags (do you? isn't it? etc.)",
      description:
        "Adding a little tag to a statement — positive sentence → negative tag and vice versa, with the right auxiliary.",
      estimatedMinutes: 25,
    },

    // ── -ing and to ... ───────────────────────────────────────────────
    {
      slug: "53-verb-ing",
      title: "Verb + -ing (enjoy doing / stop doing etc.)",
      description:
        "Verbs that are followed by -ing: enjoy, finish, stop, mind, suggest, admit, avoid, consider — and the negative not -ing.",
      estimatedMinutes: 25,
    },
    {
      slug: "54-verb-to",
      title: "Verb + to ... (decide to ... / forget to ... etc.)",
      description:
        "Verbs followed by to + infinitive: decide, hope, offer, promise, refuse, manage, learn, deserve — and verb + question word + to.",
      estimatedMinutes: 25,
    },
    {
      slug: "55-verb-object-to",
      title: "Verb (+ object) + to ... (I want you to ...)",
      description:
        "want / ask / expect / tell / advise / persuade somebody to do — and the make/let exception (no to).",
      estimatedMinutes: 25,
    },
    {
      slug: "56-verb-ing-or-to-1",
      title: "Verb + -ing or to ... 1 (remember, regret etc.)",
      description:
        "Verbs whose meaning changes: remember/forget/regret to do vs doing, and go on / mean.",
      estimatedMinutes: 25,
    },
    {
      slug: "57-verb-ing-or-to-2",
      title: "Verb + -ing or to ... 2 (try, need, help)",
      description:
        "try, need and help with -ing vs to — try doing (experiment) vs try to do (attempt), and need doing (passive meaning).",
      estimatedMinutes: 25,
    },
    {
      slug: "58-verb-ing-or-to-3",
      title: "Verb + -ing or to ... 3 (like / would like etc.)",
      description:
        "like / love / hate + -ing or to, and the would like / would love / would prefer family (always + to).",
      estimatedMinutes: 25,
    },
    {
      slug: "59-prefer-and-would-rather",
      title: "prefer and would rather",
      description:
        "prefer A to B / prefer to do rather than do, and would rather (do) / would rather you did.",
      estimatedMinutes: 25,
    },
    {
      slug: "60-preposition-plus-ing",
      title: "Preposition (in/for/about etc.) + -ing",
      description:
        "After every preposition the verb takes -ing — interested in doing, good at -ing, before/after -ing, without -ing.",
      estimatedMinutes: 25,
    },
    {
      slug: "61-be-get-used-to",
      title: "be/get used to ... (I'm used to ...)",
      description:
        "be used to (something is familiar) and get used to (becoming familiar) — and why used to here is followed by -ing, not the infinitive.",
      estimatedMinutes: 25,
    },
    {
      slug: "62-verb-preposition-ing",
      title: "Verb + preposition + -ing (succeed in -ing / insist on -ing etc.)",
      description:
        "Verbs that take a preposition then -ing: succeed in, insist on, think of, dream of, approve of, accuse somebody of.",
      estimatedMinutes: 25,
    },
    {
      slug: "63-theres-no-point-in-ing",
      title: "there's no point in -ing, it's worth -ing etc.",
      description:
        "Fixed expressions followed by -ing: It's no use ..., There's no point in ..., It's (not) worth ..., have difficulty ..., spend/waste time ...",
      estimatedMinutes: 25,
    },
    {
      slug: "64-to-for-so-that",
      title: "to ... , for ... and so that ...",
      description:
        "Three ways to say why: to + verb, for + noun, and so that + clause — plus in order to and so as to.",
      estimatedMinutes: 25,
    },
    {
      slug: "65-adjective-plus-to",
      title: "Adjective + to ...",
      description:
        "It's easy/difficult/dangerous to ..., I'm glad/sorry to ..., the first/last to ..., and It was kind of you to ...",
      estimatedMinutes: 25,
    },
    {
      slug: "66-afraid-to-do-vs-afraid-of-doing",
      title: "to ... (afraid to do) and preposition + -ing (afraid of -ing)",
      description:
        "afraid to do vs afraid of doing, interested to vs interested in, sorry to vs sorry for/about.",
      estimatedMinutes: 25,
    },
    {
      slug: "67-see-somebody-do-vs-doing",
      title: "see somebody do and see somebody doing",
      description:
        "Verbs of perception: I saw her cross (the whole thing) vs I saw her crossing (in progress) — also hear, feel, watch.",
      estimatedMinutes: 25,
    },
    {
      slug: "68-ing-clauses",
      title: "-ing clauses (He hurt his knee playing football.)",
      description:
        "Using an -ing clause to say two things at once — for something happening at the same time or for a reason.",
      estimatedMinutes: 25,
    },

    // ── Articles and nouns ────────────────────────────────────────────
    {
      slug: "69-countable-uncountable-1",
      title: "Countable and uncountable 1",
      description:
        "The basic split: a/an with singular countable nouns, nothing or some with uncountable — and why advice/information/news are uncountable.",
      estimatedMinutes: 25,
    },
    {
      slug: "70-countable-uncountable-2",
      title: "Countable and uncountable 2",
      description:
        "Nouns that work both ways with a change of meaning — a paper / paper, a coffee / coffee — and a piece of / a bit of.",
      estimatedMinutes: 25,
    },
    {
      slug: "71-countable-with-a-an-and-some",
      title: "Countable nouns with a/an and some",
      description:
        "a/an = one, for jobs and 'what kind', and some/any with plural countable and uncountable nouns.",
      estimatedMinutes: 20,
    },
    {
      slug: "72-a-an-and-the",
      title: "a/an and the",
      description:
        "a/an when it's new or one of many, the when it's clear which one — the first meeting vs every meeting after.",
      estimatedMinutes: 25,
    },
    {
      slug: "73-the-1",
      title: "the 1",
      description:
        "the for things there's only one of (the sun, the moon, the internet) and the + singular noun for a whole class.",
      estimatedMinutes: 25,
    },
    {
      slug: "74-the-2-school-vs-the-school",
      title: "the 2 (school / the school etc.)",
      description:
        "No the for the idea or purpose (go to school, in hospital, to bed) vs the for the actual building or place.",
      estimatedMinutes: 25,
    },
    {
      slug: "75-the-3-children-vs-the-children",
      title: "the 3 (children / the children)",
      description:
        "No the when you mean things or people in general (I like music, children learn fast) vs the for a specific group.",
      estimatedMinutes: 25,
    },
    {
      slug: "76-the-4-the-giraffe-the-telephone",
      title: "the 4 (the giraffe / the telephone / the old etc.)",
      description:
        "the + singular for a whole species or invention (the giraffe, the telephone), and the + adjective for a group (the old, the rich, the unemployed) and nationalities.",
      estimatedMinutes: 25,
    },
    {
      slug: "77-names-with-without-the-1",
      title: "Names with and without the 1",
      description:
        "People and places: no the with most names (continents, countries, cities, streets) but the with seas, rivers and plurals (the Netherlands).",
      estimatedMinutes: 25,
    },
    {
      slug: "78-names-with-without-the-2",
      title: "Names with and without the 2",
      description:
        "More names: hotels, restaurants, shops, universities, and the ... of ... pattern (the University of London, the Bank of England).",
      estimatedMinutes: 25,
    },
    {
      slug: "79-singular-and-plural",
      title: "Singular and plural",
      description:
        "Tricky agreement: a means of, a series of, police are, the staff are, a pair of trousers, and team/family as singular or plural.",
      estimatedMinutes: 25,
    },
    {
      slug: "80-noun-plus-noun",
      title: "Noun + noun (a bus driver / a headache)",
      description:
        "Putting two nouns together where the first describes the second — and why the first one stays singular (a five-day holiday).",
      estimatedMinutes: 25,
    },
    {
      slug: "81-possessive-s-and-of",
      title: "-'s (your sister's name) and of ... (the name of the book)",
      description:
        "'s for people and animals, of for things — plus the shop's name vs the name of the book, and time expressions (a week's holiday).",
      estimatedMinutes: 25,
    },

    // ── Pronouns and determiners ──────────────────────────────────────
    {
      slug: "82-myself-yourself-themselves",
      title: "myself/yourself/themselves etc.",
      description:
        "Reflexive pronouns for when subject and object are the same — and each other vs ourselves, by myself, and enjoy yourself.",
      estimatedMinutes: 25,
    },
    {
      slug: "83-a-friend-of-mine-my-own",
      title: "a friend of mine; my own house; on my own / by myself",
      description:
        "a friend of mine / a friend of Tom's, my own (nobody else's), and on my own / by myself = alone.",
      estimatedMinutes: 25,
    },
    {
      slug: "84-there-and-it",
      title: "there ... and it ...",
      description:
        "there is/are to say something exists, it for the weather, time, distance and situations — and there's no point / it's no use.",
      estimatedMinutes: 25,
    },
    {
      slug: "85-some-and-any",
      title: "some and any",
      description:
        "some in positives (and offers/requests), any in negatives and questions — plus anybody, anything, anywhere and any = it doesn't matter which.",
      estimatedMinutes: 25,
    },
    {
      slug: "86-no-none-any-nothing-nobody",
      title: "no/none/any; nothing/nobody etc.",
      description:
        "no + noun, none on its own, and the double-negative trap — I have no money / I don't have any money, not I don't have no money.",
      estimatedMinutes: 25,
    },
    {
      slug: "87-much-many-little-few-a-lot",
      title: "much, many, little, few, a lot, plenty",
      description:
        "How much vs how many, the meaning gap between little/few (not much) and a little/a few (some), and a lot of / plenty of.",
      estimatedMinutes: 25,
    },
    {
      slug: "88-all-most-some-none-of",
      title: "all / all of; most / most of; no / none of etc.",
      description:
        "Quantifiers before a noun vs before of the / of them — all children but all of the children, most people but most of us.",
      estimatedMinutes: 25,
    },
    {
      slug: "89-both-neither-either",
      title: "both / both of; neither / neither of; either / either of",
      description:
        "Talking about two things: both (the two), neither (not one and not the other), either (one or the other) — and both ... and / neither ... nor.",
      estimatedMinutes: 25,
    },
    {
      slug: "90-all-every-whole",
      title: "all, every and whole",
      description:
        "all + plural vs every + singular, whole for a complete thing (the whole day), and every day vs all day.",
      estimatedMinutes: 25,
    },
    {
      slug: "91-each-and-every",
      title: "each and every",
      description:
        "each (two or more, one by one) vs every (three or more, the whole group) — each of, every one, everyone/everybody.",
      estimatedMinutes: 25,
    },

    // ── Relative clauses ──────────────────────────────────────────────
    {
      slug: "92-relative-clauses-1-who-that-which",
      title: "Relative clauses 1: clauses with who/that/which",
      description:
        "Adding 'who/which/that' to say which person or thing you mean — who for people, which for things, that for either.",
      estimatedMinutes: 25,
    },
    {
      slug: "93-relative-clauses-2-with-and-without",
      title: "Relative clauses 2: clauses with and without who/that/which",
      description:
        "When you can drop the relative pronoun — the man I saw — and why you can't when it's the subject.",
      estimatedMinutes: 25,
    },
    {
      slug: "94-relative-clauses-3-whose-whom-where",
      title: "Relative clauses 3: whose/whom/where",
      description:
        "whose for possession, whom as a formal object, where for places — and the day/reason (the day when / the reason why).",
      estimatedMinutes: 25,
    },
    {
      slug: "95-relative-clauses-4-extra-info-1",
      title: "Relative clauses 4: extra information clauses (1)",
      description:
        "Non-defining clauses set off by commas — extra information you could remove, where that isn't allowed.",
      estimatedMinutes: 25,
    },
    {
      slug: "96-relative-clauses-5-extra-info-2",
      title: "Relative clauses 5: extra information clauses (2)",
      description:
        "More non-defining clauses: some of whom, most of which, which referring to a whole idea, and prepositions (to whom / in which).",
      estimatedMinutes: 25,
    },
    {
      slug: "97-ing-and-ed-clauses",
      title: "-ing and -ed clauses (the woman talking to Tom, the boy injured in the accident)",
      description:
        "Shortening a relative clause with -ing (active) or -ed (passive) — the man driving the car, the window broken in the storm.",
      estimatedMinutes: 25,
    },

    // ── Adjectives and adverbs ────────────────────────────────────────
    {
      slug: "98-adjectives-ing-and-ed",
      title: "Adjectives ending in -ing and -ed (boring/bored etc.)",
      description:
        "The cause vs the feeling: a boring film makes you bored, interesting news leaves you interested — never mix them up.",
      estimatedMinutes: 25,
    },
    {
      slug: "99-adjectives-order-and-after-verbs",
      title: "Adjectives: a nice new house, you look tired",
      description:
        "The order of adjectives before a noun, and the verbs (look, feel, smell, taste, sound) that take an adjective, not an adverb.",
      estimatedMinutes: 25,
    },
    {
      slug: "100-adjectives-and-adverbs-1",
      title: "Adjectives and adverbs 1 (quick/quickly)",
      description:
        "Adverbs describe verbs and adjectives describe nouns — drive carefully, a careful driver — plus -ly spelling.",
      estimatedMinutes: 25,
    },
    {
      slug: "101-adjectives-and-adverbs-2-hard-hardly",
      title: "Adjectives and adverbs 2 (well, fast, late, hard/hardly)",
      description:
        "Words that look the same as adjective and adverb (fast, hard, late), good vs well, and the tricky pair hard / hardly.",
      estimatedMinutes: 25,
    },
    {
      slug: "102-so-and-such",
      title: "so and such",
      description:
        "so + adjective/adverb, such + (adjective) noun, and the so ... that / such ... that result pattern.",
      estimatedMinutes: 25,
    },
    {
      slug: "103-enough-and-too",
      title: "enough and too",
      description:
        "enough after adjectives but before nouns, too + adjective, and the enough/too to do and too ... for ... patterns.",
      estimatedMinutes: 25,
    },
    {
      slug: "104-quite-pretty-rather-fairly",
      title: "quite, pretty, rather and fairly",
      description:
        "The 'a bit but not very' words and how strong each one is — plus quite a (quite a nice day) and quite = completely.",
      estimatedMinutes: 25,
    },
    {
      slug: "105-comparative-1",
      title: "Comparative 1 (cheaper, more expensive etc.)",
      description:
        "Making comparatives: short words take -er, longer words take more — plus the irregulars better, worse, further.",
      estimatedMinutes: 25,
    },
    {
      slug: "106-comparative-2",
      title: "Comparative 2 (much better / any better etc.)",
      description:
        "Strengthening and softening comparatives — much/far/a bit + comparative, better and better, and the ... the ...",
      estimatedMinutes: 25,
    },
    {
      slug: "107-comparative-3-as-as",
      title: "Comparative 3 (as ... as / than)",
      description:
        "as ... as for equal things, not as ... as for unequal, the same as — and the than me / than I am choice.",
      estimatedMinutes: 25,
    },
    {
      slug: "108-superlative",
      title: "Superlative (the longest, the most enjoyable etc.)",
      description:
        "Top of the group with the -est / the most ..., the irregulars, and the it's the best I've ever ... pattern.",
      estimatedMinutes: 25,
    },
    {
      slug: "109-word-order-1-verb-object-place-time",
      title: "Word order 1: verb + object; place and time",
      description:
        "Keep the verb and its object together, and put place before time — I went to the cinema yesterday.",
      estimatedMinutes: 25,
    },
    {
      slug: "110-word-order-2-adverbs-with-the-verb",
      title: "Word order 2: adverbs with the verb",
      description:
        "Where adverbs of frequency and certainty go — before the main verb but after am/is/are (always, probably, also, both).",
      estimatedMinutes: 25,
    },
    {
      slug: "111-still-any-more-yet-already",
      title: "still, any more, yet, already",
      description:
        "still (it continues), any more / any longer (it has stopped), yet (expected but hasn't happened), already (sooner than expected).",
      estimatedMinutes: 25,
    },
    {
      slug: "112-even",
      title: "even",
      description:
        "even for the surprising or extreme (even a child could do it), its position in the sentence, and even though / even if / even when.",
      estimatedMinutes: 25,
    },

    // ── Conjunctions and prepositions ─────────────────────────────────
    {
      slug: "113-although-though-even-though-in-spite-of",
      title: "although, though, even though; in spite of, despite",
      description:
        "Two ways to say 'but unexpectedly' — although / though / even though + clause vs in spite of / despite + noun or -ing.",
      estimatedMinutes: 25,
    },
    {
      slug: "114-in-case",
      title: "in case",
      description:
        "in case = because it might happen (take an umbrella in case it rains) — and why it isn't the same as if.",
      estimatedMinutes: 25,
    },
    {
      slug: "115-unless-as-long-as-provided",
      title: "unless, as long as, provided",
      description:
        "Conditions in disguise: unless = except if, and as long as / provided (that) / providing (that) = only if.",
      estimatedMinutes: 25,
    },
    {
      slug: "116-as",
      title: "as (as I walked ... / as I was ... etc.)",
      description:
        "The many jobs of as: 'while / at the same time' (as I walked home, I met Tom), 'because' (as it was getting late, we left), and 'in the way that' (do as I say).",
      estimatedMinutes: 25,
    },
    {
      slug: "117-like-and-as",
      title: "like and as",
      description:
        "like + noun for 'similar to' vs as + noun for 'in the role of' — like a child vs as a teacher.",
      estimatedMinutes: 25,
    },
    {
      slug: "118-like-as-if",
      title: "like, as if",
      description:
        "Saying how something seems — it looks as if / as though it's going to rain, the informal she looks like she's tired — plus the unreal as if I knew.",
      estimatedMinutes: 25,
    },
    {
      slug: "119-during-for-while",
      title: "during, for and while",
      description:
        "for + length of time, during + noun (during the film), while + clause (while I was watching) — three ways to say 'when'.",
      estimatedMinutes: 25,
    },
    {
      slug: "120-by-and-until",
      title: "by and until; by the time ...",
      description:
        "until for how long something continues, by for a deadline (not later than) — and the by the time ... construction.",
      estimatedMinutes: 25,
    },

    // ── Prepositions ──────────────────────────────────────────────────
    {
      slug: "121-at-on-in-time",
      title: "at/on/in (time)",
      description:
        "at for clock times and points, on for days and dates, in for longer periods — plus the no-preposition cases (this/last/next/every).",
      estimatedMinutes: 25,
    },
    {
      slug: "122-on-time-in-time-at-the-end",
      title: "on time and in time; at the end and in the end",
      description:
        "Two pairs that trip people up: on time (punctual) vs in time (early enough), and at the end (the point) vs in the end (finally).",
      estimatedMinutes: 25,
    },
    {
      slug: "123-in-at-on-position-1",
      title: "in/at/on (position) 1",
      description:
        "The big three for place: in (inside something), at (a point), on (a surface) — with the everyday examples.",
      estimatedMinutes: 25,
    },
    {
      slug: "124-in-at-on-position-2",
      title: "in/at/on (position) 2",
      description:
        "More place uses: in a photo / in the sky, at the top / at the door, on the left / on a river / on the way.",
      estimatedMinutes: 25,
    },
    {
      slug: "125-in-at-on-position-3",
      title: "in/at/on (position) 3",
      description:
        "at vs in a building, at the station / airport, on a bus/train/plane (but in a car/taxi), at home / at work / in bed.",
      estimatedMinutes: 25,
    },
    {
      slug: "126-to-at-in-into",
      title: "to, at, in and into",
      description:
        "Movement vs position: go to (direction) vs be at/in (place), and get into / out of vs get on / off.",
      estimatedMinutes: 25,
    },
    {
      slug: "127-in-on-at-other-uses",
      title: "in/on/at (other uses)",
      description:
        "Beyond time and place: in English / in pen / in love, on holiday / on the phone / on purpose, at the age of / at 50 km/h.",
      estimatedMinutes: 25,
    },
    {
      slug: "128-by",
      title: "by",
      description:
        "The many jobs of by: by car / by chance / by mistake, a play by Shakespeare, the passive by, and by + reflexive.",
      estimatedMinutes: 25,
    },
    {
      slug: "129-noun-plus-preposition",
      title: "Noun + preposition (reason for, cause of etc.)",
      description:
        "The preposition each noun locks onto: a reason for, a cause of, an advantage of, damage to, a rise in, the relationship between.",
      estimatedMinutes: 25,
    },
    {
      slug: "130-adjective-plus-preposition-1",
      title: "Adjective + preposition 1",
      description:
        "Adjective partners: nice/kind/good of you, nice/kind/good to somebody, angry about/with, sorry about/for, and afraid/proud/aware of.",
      estimatedMinutes: 25,
    },
    {
      slug: "131-adjective-plus-preposition-2",
      title: "Adjective + preposition 2",
      description:
        "More pairs: good/bad at, married/engaged to, fed up with, surprised/shocked at/by, famous/responsible for, interested in, full of.",
      estimatedMinutes: 25,
    },
    {
      slug: "132-verb-plus-preposition-1-to-at",
      title: "Verb + preposition 1 (to and at)",
      description:
        "Verbs that take to (happen to, listen to, belong to, apologise to) and at (look at, laugh at, shout at, point at).",
      estimatedMinutes: 25,
    },
    {
      slug: "133-verb-plus-preposition-2-about-for-of-after",
      title: "Verb + preposition 2 (about/for/of/after)",
      description:
        "care about / care for, ask for, search for, leave for, think about/of, hear about/of/from, and look after.",
      estimatedMinutes: 25,
    },
    {
      slug: "134-verb-plus-preposition-3-about-and-of",
      title: "Verb + preposition 3 (about and of)",
      description:
        "dream about/of, complain to somebody about, remind somebody of/about, warn somebody about, accuse/suspect somebody of.",
      estimatedMinutes: 25,
    },
    {
      slug: "135-verb-plus-preposition-4-of-for-from-on",
      title: "Verb + preposition 4 (of/for/from/on)",
      description:
        "approve of, die of/from, suffer from, protect from, thank/forgive somebody for, depend/rely on, live on, congratulate on.",
      estimatedMinutes: 25,
    },
    {
      slug: "136-verb-plus-preposition-5-in-into-with-to-on",
      title: "Verb + preposition 5 (in/into/with/to/on)",
      description:
        "believe in, specialise in, crash into, divide into, collide with, provide somebody with, happen to, prefer to, concentrate on, insist on.",
      estimatedMinutes: 25,
    },

    // ── Phrasal verbs ─────────────────────────────────────────────────
    {
      slug: "137-phrasal-verbs-1-introduction",
      title: "Phrasal verbs 1: Introduction",
      description:
        "How a verb + a small word (in/out/up/down/on/off) makes a new meaning, and where the object goes (turn it on, not turn on it).",
      estimatedMinutes: 25,
    },
    {
      slug: "138-phrasal-verbs-2-in-out",
      title: "Phrasal verbs 2: in/out",
      description:
        "in for entering/arriving (get in, fill in, plug in) and out for leaving/excluding (go out, work out, cut out, eat out).",
      estimatedMinutes: 25,
    },
    {
      slug: "139-phrasal-verbs-3-out",
      title: "Phrasal verbs 3: out",
      description:
        "More out: find out, point out, sort out, turn out, run out (of), give out, try out — out for 'finished' or 'made known'.",
      estimatedMinutes: 25,
    },
    {
      slug: "140-phrasal-verbs-4-on-off-1",
      title: "Phrasal verbs 4: on/off (1)",
      description:
        "on for continuing and connecting (go on, get on, put on, keep on) vs off for stopping and disconnecting (turn off, take off, call off).",
      estimatedMinutes: 25,
    },
    {
      slug: "141-phrasal-verbs-5-on-off-2",
      title: "Phrasal verbs 5: on/off (2)",
      description:
        "More on/off: get on (with), go off (food/alarm), put somebody off, take off (leave the ground / become successful), show off, drop off.",
      estimatedMinutes: 25,
    },
    {
      slug: "142-phrasal-verbs-6-up-down",
      title: "Phrasal verbs 6: up/down",
      description:
        "up and down as a pair — up for increase and completion, down for decrease and stopping: turn up/down, slow down, break down, calm down, knock down.",
      estimatedMinutes: 25,
    },
    {
      slug: "143-phrasal-verbs-7-up-1",
      title: "Phrasal verbs 7: up (1)",
      description:
        "up for finishing completely and getting upright: eat up, use up, fill up, do up, get up, stand up, pick up — up = 'all the way'.",
      estimatedMinutes: 25,
    },
    {
      slug: "144-phrasal-verbs-8-up-2",
      title: "Phrasal verbs 8: up (2)",
      description:
        "up for creating, appearing and increasing: bring up, grow up, make up, turn up, show up, set up, speak up, and put up with.",
      estimatedMinutes: 25,
    },
    {
      slug: "145-phrasal-verbs-9-away-back",
      title: "Phrasal verbs 9: away/back",
      description:
        "away for leaving and disappearing (go away, get away, throw away, put away) and back for returning (come back, go back, pay back, get back, call back).",
      estimatedMinutes: 25,
    },
  ],
};

export default textbook;
