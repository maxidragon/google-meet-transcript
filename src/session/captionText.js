/**
 * Google Meet rewrites a caption line in place while someone is still speaking:
 * the text grows word by word, gets re-recognised (so earlier words change), and
 * once the line is too long for the caption box Meet drops words off the front.
 * These helpers turn that stream of snapshots back into one stable utterance.
 */

// Below this many characters, a shared boundary between the stored text and the
// incoming snapshot is as likely to be a coincidence ("a", "to") as a real
// overlap, and gluing on a coincidence corrupts the word.
const MINIMUM_OVERLAP_LENGTH = 6;

/**
 * Fold the newest snapshot of a caption line into the text captured so far.
 *
 * @example
 * mergeCaptionText("we should", "we should ship it") // "we should ship it"
 * mergeCaptionText("we should ship", "should ship it now") // "we should ship it now"
 */
export function mergeCaptionText(storedText, incomingText) {
  const stored = storedText.trim();
  const incoming = incomingText.trim();
  if (stored === "") return incoming;
  if (incoming === "") return stored;
  if (incoming.startsWith(stored)) return incoming;
  if (stored.startsWith(incoming)) return stored;

  const overlap = longestSharedBoundary(stored, incoming);
  if (overlap >= MINIMUM_OVERLAP_LENGTH) return stored + incoming.slice(overlap);
  return `${stored} ${incoming}`;
}

// Length of the longest suffix of `stored` that is also a prefix of `incoming`.
function longestSharedBoundary(stored, incoming) {
  const maximum = Math.min(stored.length, incoming.length);
  for (let length = maximum; length > 0; length -= 1) {
    if (stored.endsWith(incoming.slice(0, length))) return length;
  }
  return 0;
}

const POLISH_LETTERS = /[ąćęłńóśźż]/i;
const POLISH_WORDS =
  /\b(nie|tak|jest|się|że|jak|ale|czy|dla|oraz|jeszcze|dobrze|teraz|może|trzeba|mamy|będzie)\b/i;
const ENGLISH_WORDS =
  /\b(the|and|that|with|this|have|we're|about|would|there|because|going|right|okay|just)\b/i;

/**
 * Best guess at the language a transcript was spoken in, used to label exports.
 * Returns `null` when the sample is too short or matches neither language.
 */
export function detectLanguage(text) {
  if (text.trim().length < 20) return null;
  if (POLISH_LETTERS.test(text) || POLISH_WORDS.test(text)) return "pl";
  if (ENGLISH_WORDS.test(text)) return "en";
  return null;
}
