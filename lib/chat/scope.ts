/**
 * Deciding what Chaatak will answer.
 *
 * Chaatak is a weather assistant, not a general assistant — but the boundary
 * is generous and UNSURE RESOLVES TO IN SCOPE. Turning away a farmer's real
 * question is a worse failure than answering a slightly off-topic one, and
 * "क्या आज घर से निकलूँ?" is a weather question wearing casual clothes.
 *
 * Three outcomes:
 *   inScope false               → one friendly redirecting line
 *   inScope, needsWeather true  → fetch, ground, answer
 *   inScope, needsWeather false → converse; no fetch, no citation
 */

export const SCOPE_RULES = [
  'Chaatak is a weather assistant. Decide whether you can help.',
  '',
  'IN SCOPE — anything that depends on weather in any way:',
  '  - forecasts, current conditions, warnings',
  '  - advice that depends on conditions: playing a sport, travelling,',
  '    what to wear, spraying crops, drying clothes, harvesting, going out',
  '  - explanations of weather terms, warning colours, what a code means',
  '  - questions about Chaatak itself, its data, or where its numbers come from',
  '  - greetings and small talk on the way to a weather question',
  '',
  'OUT OF SCOPE — genuinely unrelated requests only:',
  '  - writing code, essays or poems',
  '  - general knowledge, maths, trivia',
  '  - personal advice with no weather bearing',
  '',
  'If a question could plausibly depend on weather, it IS in scope. When you',
  'are unsure, choose in scope. Refusing a real question is the worse error.',
  '',
  'needsWeather: true when answering requires actual values for a place.',
  'false for term explanations, questions about Chaatak, and small talk.',
].join('\n');

/** One friendly line, no lecture, no refusal boilerplate. */
export const REDIRECT = {
  hi: 'मैं तो मौसम के लिए हूँ — ये मुझसे न पूछिए। मौसम का कुछ पूछना हो तो बताइए।',
  en: "I'm just the weather — that one's outside what I do. Ask me about the weather instead.",
};

/**
 * The question needs a place and the question did not name one.
 *
 * Asked as a question, not stated as a failure: the person did nothing wrong
 * by typing "temperature". The interface offers "use my location" beside this
 * line, so both ways of answering it are one tap away.
 *
 * A template, never a model call. There is nothing to reason about here, and
 * an answer that has not fetched anything has no business spending a request.
 */
export const ASK_FOR_LOCATION = {
  hi: 'किस जगह का बताऊँ? जगह का नाम लिखें, या अपनी जगह इस्तेमाल करने दें।',
  en: 'Which place should I use? Type a place name, or let me use your location.',
};
