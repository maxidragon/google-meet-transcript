import { mergeCaptionText } from "./captionText.js";

/**
 * @typedef {{ blockId: string, speaker: string | null, text: string }} CaptionBlock
 *   One caption line as it currently reads on screen. `blockId` identifies the
 *   DOM node the line lives in, so a line that is still being spoken can be
 *   recognised across snapshots.
 * @typedef {{ speaker: string | null, text: string, startedAtMs: number }} TranscriptEntry
 * @typedef {{ entries: TranscriptEntry[], openEntryIndexByBlockId: Record<string, number> }} SessionState
 */

/** @returns {SessionState} */
export function createSessionState() {
  return { entries: [], openEntryIndexByBlockId: {} };
}

/**
 * Fold the caption lines currently on screen into the session.
 *
 * Returns the state unchanged (same object identity) when the snapshot adds
 * nothing, so callers can skip persisting and re-rendering.
 *
 * @param {SessionState} state
 * @param {CaptionBlock[]} blocks
 * @param {number} nowMs
 * @returns {SessionState}
 */
export function applyCaptionSnapshot(state, blocks, nowMs) {
  const entries = [...state.entries];
  const openEntryIndexByBlockId = { ...state.openEntryIndexByBlockId };
  let changed = false;

  for (const block of blocks) {
    const text = block.text.trim();
    if (text === "") continue;

    const openIndex = openEntryIndexByBlockId[block.blockId];
    const openEntry = openIndex == null ? null : entries[openIndex];
    // Meet recycles a caption node for the next person to speak; the same node
    // showing a different name is a new utterance, not a correction of the old.
    const continuesOpenEntry = openEntry != null && openEntry.speaker === block.speaker;

    if (continuesOpenEntry) {
      const mergedText = mergeCaptionText(openEntry.text, text);
      if (mergedText === openEntry.text) continue;
      entries[openIndex] = { ...openEntry, text: mergedText };
      changed = true;
      continue;
    }

    openEntryIndexByBlockId[block.blockId] = entries.length;
    entries.push({ speaker: block.speaker, text, startedAtMs: nowMs });
    changed = true;
  }

  if (!changed) return state;
  return { entries, openEntryIndexByBlockId };
}

/**
 * The open-entry indexes worth carrying into the next snapshot. A caption line
 * that has scrolled off screen never changes again, so keeping its index only
 * grows what the recorder has to store between snapshots.
 *
 * @param {SessionState} state
 * @param {CaptionBlock[]} blocks
 * @returns {Record<string, number>}
 */
export function openEntriesForBlocks(state, blocks) {
  const kept = {};
  for (const block of blocks) {
    const index = state.openEntryIndexByBlockId[block.blockId];
    if (index != null) kept[block.blockId] = index;
  }
  return kept;
}
