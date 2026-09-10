/**
 * Stored transcripts, split so the popup can list meetings without loading
 * every spoken line: `meta:<id>` holds what the list shows, `entries:<id>` the
 * transcript itself.
 *
 * @typedef {import("./transcriptFormats.js").TranscriptRecord} TranscriptRecord
 * @typedef {Omit<TranscriptRecord, "entries"> & { entryCount: number }} TranscriptSummary
 */

const META_PREFIX = "meta:";
const ENTRIES_PREFIX = "entries:";

/** @returns {Promise<TranscriptSummary[]>} newest meeting first. */
export async function listTranscripts() {
  const keys = await chrome.storage.local.getKeys();
  const metaKeys = keys.filter((key) => key.startsWith(META_PREFIX));
  if (metaKeys.length === 0) return [];
  const stored = await chrome.storage.local.get(metaKeys);
  return Object.values(stored).sort((left, right) => right.startedAtMs - left.startedAtMs);
}

/** @returns {Promise<TranscriptRecord | null>} */
export async function loadTranscript(id) {
  const stored = await chrome.storage.local.get([META_PREFIX + id, ENTRIES_PREFIX + id]);
  const meta = stored[META_PREFIX + id];
  if (meta == null) return null;
  const { entryCount, ...record } = meta;
  return { ...record, entries: stored[ENTRIES_PREFIX + id] ?? [] };
}

/**
 * @param {TranscriptRecord} record
 * @returns {Promise<void>}
 */
export async function saveTranscript(record) {
  const { entries, ...meta } = record;
  await chrome.storage.local.set({
    [META_PREFIX + record.id]: { ...meta, entryCount: entries.length },
    [ENTRIES_PREFIX + record.id]: entries,
  });
}

/** @returns {Promise<void>} */
export async function deleteTranscript(id) {
  await chrome.storage.local.remove([META_PREFIX + id, ENTRIES_PREFIX + id]);
}
