/**
 * Owns the transcript of every meeting being recorded.
 *
 * The content script only reads what is on screen; keeping the session here
 * means a reload of the meeting tab does not lose the recording. Nothing is
 * held in memory that cannot be rebuilt from storage after the service worker
 * is suspended: what is being recorded lives in session storage, the transcript
 * itself in local storage.
 */
import "../messaging.js";
import { detectLanguage } from "../session/captionText.js";
import { applyCaptionSnapshot, openEntriesForBlocks } from "../session/transcriptSession.js";
import { loadTranscript, saveTranscript } from "../session/transcriptStore.js";

const MESSAGE = globalThis.MEET_TRANSCRIPT_MESSAGES;

const SAVE_DEBOUNCE_MS = 3000;
const LANGUAGE_SAMPLE_LENGTH = 600;
const PREVIEW_LENGTH = 120;
const RECORDING_KEY_PREFIX = "recording:";
const RECORDING_BADGE = "REC";
const RECORDING_COLOUR = "#dc2626";

/**
 * @typedef {{
 *   sessionId: string,
 *   meetingCode: string,
 *   title: string,
 *   startedAtMs: number,
 *   openEntryIndexByBlockId: Record<string, number>
 * }} Recording
 */

/** Caches rebuilt from storage whenever the worker wakes up. */
const entriesBySessionId = new Map();
const saveTimersBySessionId = new Map();

let lastSaveFailure = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  respond(message, sender).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  finishRecording(tabId).catch((error) => console.error("Meet Transcript", error));
});

async function respond(message, sender) {
  switch (message.type) {
    case MESSAGE.getStatus:
      return readStatus(message.tabId);
    case MESSAGE.startCapture:
      return startCapture(message.tabId);
    case MESSAGE.stopCapture:
      return stopCapture(message.tabId);
    case MESSAGE.captionBlocks:
      return recordCaptions(sender.tab.id, message.blocks);
    case MESSAGE.isTabRecording:
      return { recording: (await readRecording(sender.tab.id)) != null };
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * @typedef {{
 *   recording: boolean,
 *   startedAtMs: number | null,
 *   entryCount: number,
 *   lastLine: string | null,
 *   saveFailure: string | null
 * }} CaptureStatus
 * @returns {Promise<CaptureStatus>}
 */
async function readStatus(tabId) {
  const recording = await readRecording(tabId);
  if (recording == null) {
    return {
      recording: false,
      startedAtMs: null,
      entryCount: 0,
      lastLine: null,
      saveFailure: lastSaveFailure,
    };
  }
  const entries = await entriesFor(recording.sessionId);
  const lastEntry = entries[entries.length - 1];
  return {
    recording: true,
    startedAtMs: recording.startedAtMs,
    entryCount: entries.length,
    lastLine: lastEntry == null ? null : lastEntry.text.slice(-PREVIEW_LENGTH),
    saveFailure: lastSaveFailure,
  };
}

async function startCapture(tabId) {
  if ((await readRecording(tabId)) != null) return readStatus(tabId);

  const pageState = await chrome.tabs.sendMessage(tabId, { type: MESSAGE.getPageState });
  const recording = {
    sessionId: crypto.randomUUID(),
    meetingCode: pageState.meetingCode,
    title: pageState.title === "" ? pageState.meetingCode : pageState.title,
    startedAtMs: Date.now(),
    openEntryIndexByBlockId: {},
  };
  entriesBySessionId.set(recording.sessionId, []);
  // Written before the page starts reading, so the first caption lines never
  // arrive at a worker that does not yet know this tab is recording.
  await writeRecording(tabId, recording);
  await chrome.tabs.sendMessage(tabId, { type: MESSAGE.startReading });
  await showBadge(tabId, true);
  return readStatus(tabId);
}

async function stopCapture(tabId) {
  await finishRecording(tabId);
  await chrome.tabs
    .sendMessage(tabId, { type: MESSAGE.stopReading })
    .catch(ignoreMissingTab);
  return readStatus(tabId);
}

async function finishRecording(tabId) {
  const recording = await readRecording(tabId);
  if (recording == null) return;
  await clearRecording(tabId);
  clearScheduledSave(recording.sessionId);
  await save(recording, Date.now());
  entriesBySessionId.delete(recording.sessionId);
  await showBadge(tabId, false);
}

async function recordCaptions(tabId, blocks) {
  const recording = await readRecording(tabId);
  if (recording == null) return { recording: false };

  const entries = await entriesFor(recording.sessionId);
  const previousState = {
    entries,
    openEntryIndexByBlockId: recording.openEntryIndexByBlockId,
  };
  const state = applyCaptionSnapshot(previousState, blocks, Date.now());
  if (state.entries === entries) return { recording: true };

  entriesBySessionId.set(recording.sessionId, state.entries);
  await writeRecording(tabId, {
    ...recording,
    openEntryIndexByBlockId: openEntriesForBlocks(state, blocks),
  });
  scheduleSave(recording);
  return { recording: true };
}

function scheduleSave(recording) {
  if (saveTimersBySessionId.has(recording.sessionId)) return;
  const timer = setTimeout(() => {
    saveTimersBySessionId.delete(recording.sessionId);
    save(recording, null).catch(reportSaveFailure);
  }, SAVE_DEBOUNCE_MS);
  saveTimersBySessionId.set(recording.sessionId, timer);
}

function clearScheduledSave(sessionId) {
  const timer = saveTimersBySessionId.get(sessionId);
  if (timer == null) return;
  clearTimeout(timer);
  saveTimersBySessionId.delete(sessionId);
}

async function save(recording, endedAtMs) {
  const entries = await entriesFor(recording.sessionId);
  if (entries.length === 0) return;
  await saveTranscript({
    id: recording.sessionId,
    meetingCode: recording.meetingCode,
    title: recording.title,
    startedAtMs: recording.startedAtMs,
    endedAtMs,
    language: detectLanguage(languageSample(entries)),
    entries,
  });
  lastSaveFailure = null;
}

/**
 * A failed write — a full storage quota is the realistic cause — must not end
 * the recording: the transcript is still in memory and the next batch of
 * captions schedules another attempt. The popup shows what went wrong.
 */
function reportSaveFailure(error) {
  console.error("Meet Transcript could not save", error);
  lastSaveFailure = error.message;
}

async function entriesFor(sessionId) {
  const cached = entriesBySessionId.get(sessionId);
  if (cached != null) return cached;
  const stored = await loadTranscript(sessionId);
  const entries = stored?.entries ?? [];
  entriesBySessionId.set(sessionId, entries);
  return entries;
}

function languageSample(entries) {
  let sample = "";
  for (const entry of entries) {
    sample += ` ${entry.text}`;
    if (sample.length >= LANGUAGE_SAMPLE_LENGTH) break;
  }
  return sample;
}

/** @returns {Promise<Recording | null>} */
async function readRecording(tabId) {
  const key = RECORDING_KEY_PREFIX + tabId;
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function writeRecording(tabId, recording) {
  await chrome.storage.session.set({ [RECORDING_KEY_PREFIX + tabId]: recording });
}

async function clearRecording(tabId) {
  await chrome.storage.session.remove(RECORDING_KEY_PREFIX + tabId);
}

async function showBadge(tabId, recording) {
  await chrome.action
    .setBadgeBackgroundColor({ tabId, color: RECORDING_COLOUR })
    .catch(ignoreMissingTab);
  await chrome.action
    .setBadgeText({ tabId, text: recording ? RECORDING_BADGE : "" })
    .catch(ignoreMissingTab);
}

// Stopping a recording because its tab closed is the normal way a meeting ends;
// there is no page left to tell about it.
function ignoreMissingTab(error) {
  if (/Receiving end does not exist|No tab with id/.test(error.message)) return;
  throw error;
}
