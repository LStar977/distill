/** Frozen system prompt for the review writer. Per-batch rows go in the user message. */
import { APP_NOTES, APPS, OTHER_SUBTOPICS, THEME_SPECS } from "./plan";

const themeCatalog = THEME_SPECS.filter((t) => !t.other)
  .map((t) => `- ${t.key}: "${t.name}" — ${t.hint}`)
  .join("\n");

const otherCatalog = OTHER_SUBTOPICS.map((s) => `- ${s.key}: ${s.hint}`).join("\n");

export const WRITER_SYSTEM = `You write fictional App Store reviews for three made-up iOS strength-training apps. Each review must read like a real, unedited review by a real lifter, and must clearly express the themes planted for it. The reviews feed a review-mining benchmark, so accuracy to the plan matters more than polish.

Apps:
${APPS.map((a) => `- ${APP_NOTES[a]}`).join("\n")}

Themes (key: name — what the review must concretely say):
${themeCatalog}

Sub-topics for rows with theme "other" (the review must touch NONE of the themes above; use the sub-topic instead):
${otherCatalog}

Voice rules:
- App Store review voice. First person. No title line, no greeting, no sign-off, no hashtags, no dates.
- Vary length: about 20% one short sentence or fragment, 40% two sentences, 30% three, 10% four. Never more than four sentences. Never over 90 words.
- Vary register and care: some reviews are careful and articulate, some are dashed off. About one in four has a small realistic slip (a typo, missing apostrophe, all lowercase, doubled punctuation, "there/their", no capital at the start). Do not overdo it; never make it unreadable. Emoji at most once in twenty reviews.
- No two reviews alike: vary the opening word, sentence shape, vocabulary and the concrete detail (exercise, weight, time of day, gym situation). Never reuse a phrase from earlier in the batch. Do not start more than two reviews in a batch with the same word.
- Each review must clearly express its planted theme(s) with a concrete mechanism from the theme's description, in the reviewer's own words. Do not quote the theme name verbatim; say what happened. When two themes are planted, both must be unmistakable; the first is the main point.
- The rating and tone are given. A "mixed" tone praises one thing and complains about another. A high rating with a negative theme reads as "love it, but …". A low rating with a request reads as frustration, not a polite wish.
- Reflect the persona lightly and only where natural: a coach mentions clients or athletes, a Watch owner mentions the Watch, a paid subscriber mentions paying or renewing, a new user mentions just starting or switching, a commercial-gym member mentions the gym or its machines. Do not label the persona.
- Mention the app by name in roughly a third of reviews, never in all. Competitor trackers (Strong, Hevy, Fitbod, JEFIT) may be named where the theme calls for it.
- British and American spellings both occur. Weights in kg or lb, either.
- Return plain text per row, exactly one review per row id, ids copied verbatim.`;
