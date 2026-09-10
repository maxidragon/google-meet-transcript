import "../messaging.js";
import { renderTranscript, TRANSCRIPT_FORMATS } from "../session/transcriptFormats.js";
import { deleteTranscript, listTranscripts, loadTranscript } from "../session/transcriptStore.js";

const MESSAGE = globalThis.MEET_TRANSCRIPT_MESSAGES;

const STATUS_REFRESH_INTERVAL_MS = 1000;
const COPIED_LABEL_MS = 1500;
const MEET_URL_PREFIX = "https://meet.google.com/";

const statusLine = document.getElementById("status");
const hintLine = document.getElementById("hint");
const previewLine = document.getElementById("preview");
const toggleButton = document.getElementById("toggle");
const emptyLine = document.getElementById("empty");
const transcriptList = document.getElementById("transcripts");
const transcriptTemplate = document.getElementById("transcript-item");

translate(document);
refreshStatus().catch(reportFailure);
refreshLibrary().catch(reportFailure);
setInterval(() => refreshStatus().catch(reportFailure), STATUS_REFRESH_INTERVAL_MS);

// The popup is the top of the stack: there is nobody left to propagate to, so a
// failure is shown where the user is already looking.
function reportFailure(error) {
  console.error(error);
  hintLine.hidden = false;
  hintLine.classList.add("error");
  hintLine.textContent = error.message;
}

/**
 * Fill in every `data-i18n` label under `root`. Cloned template content needs
 * its own pass: it is not part of the document when the popup first loads.
 *
 * @param {DocumentFragment | Document} root
 */
function translate(root) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = chrome.i18n.getMessage(element.dataset.i18n);
  }
}

/**
 * The popup asks two questions: the meeting tab knows what is on the page, the
 * service worker knows what is being recorded.
 *
 * @typedef {{
 *   recording: boolean,
 *   startedAtMs: number | null,
 *   entryCount: number,
 *   lastLine: string | null,
 *   saveFailure: string | null,
 *   captionsButton: "on" | "off" | "notFound"
 * }} MeetingStatus
 * @typedef {{ kind: "notMeeting" | "needsReload" }
 *   | { kind: "meeting", tabId: number, status: MeetingStatus }} PopupState
 * @returns {Promise<PopupState>}
 */
async function readPopupState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url == null || !tab.url.startsWith(MEET_URL_PREFIX)) return { kind: "notMeeting" };

  const pageState = await chrome.tabs
    .sendMessage(tab.id, { type: MESSAGE.getPageState })
    .catch(whenContentScriptMissing);
  if (pageState == null) return { kind: "needsReload" };
  if (pageState.error != null) throw new Error(pageState.error);
  if (pageState.meetingCode === "") return { kind: "notMeeting" };

  const capture = await ask({ type: MESSAGE.getStatus, tabId: tab.id });
  return {
    kind: "meeting",
    tabId: tab.id,
    status: { ...capture, captionsButton: pageState.captionsButton },
  };
}

async function ask(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response.error != null) throw new Error(response.error);
  return response;
}

// A Meet tab opened before the extension was installed has no content script in
// it; the only fix is reloading that tab, so it is a state to render, not a
// failure to report.
function whenContentScriptMissing(error) {
  if (error.message.includes("Receiving end does not exist")) return null;
  throw error;
}

async function refreshStatus() {
  const state = await readPopupState();
  if (state.kind !== "meeting") {
    statusLine.classList.remove("recording");
    statusLine.textContent = chrome.i18n.getMessage(
      state.kind === "notMeeting" ? "statusNotMeeting" : "statusNeedsReload",
    );
    hintLine.hidden = true;
    previewLine.hidden = true;
    toggleButton.hidden = true;
    return;
  }

  const { status, tabId } = state;
  statusLine.classList.toggle("recording", status.recording);
  statusLine.textContent = status.recording
    ? chrome.i18n.getMessage("statusRecording", [String(status.entryCount)])
    : chrome.i18n.getMessage("statusIdle");

  showHint(status);
  previewLine.hidden = status.lastLine == null;
  previewLine.textContent = status.lastLine ?? "";

  toggleButton.hidden = false;
  toggleButton.textContent = chrome.i18n.getMessage(status.recording ? "stop" : "start");
  toggleButton.onclick = () => toggleRecording(tabId, status.recording).catch(reportFailure);
}

function showHint(status) {
  const hint = hintText(status);
  hintLine.hidden = hint == null;
  hintLine.textContent = hint ?? "";
  hintLine.classList.toggle("error", status.saveFailure != null);
}

function hintText(status) {
  if (status.saveFailure != null) {
    return chrome.i18n.getMessage("saveFailed", [status.saveFailure]);
  }
  if (status.captionsButton === "notFound") return chrome.i18n.getMessage("captionsNotFound");
  if (!status.recording && status.captionsButton === "off") {
    return chrome.i18n.getMessage("captionsOff");
  }
  return chrome.i18n.getMessage("captionLanguageHint");
}

async function toggleRecording(tabId, recording) {
  await ask({ type: recording ? MESSAGE.stopCapture : MESSAGE.startCapture, tabId });
  await refreshStatus();
  await refreshLibrary();
}

async function refreshLibrary() {
  const transcripts = await listTranscripts();
  transcriptList.replaceChildren(...transcripts.map(transcriptItem));
  emptyLine.hidden = transcripts.length > 0;
}

function transcriptItem(summary) {
  const item = transcriptTemplate.content.cloneNode(true);
  translate(item);
  item.querySelector(".title").textContent = summary.title;
  item.querySelector(".meta").textContent = [
    new Date(summary.startedAtMs).toLocaleString(),
    chrome.i18n.getMessage("lineCount", [String(summary.entryCount)]),
    summary.language,
  ]
    .filter((part) => part != null)
    .join(" · ");

  const format = item.querySelector(".format");
  format.replaceChildren(...TRANSCRIPT_FORMATS.map(formatOption));

  const copyButton = item.querySelector(".copy");
  copyButton.onclick = () =>
    copyTranscript(summary.id, format.value, copyButton).catch(reportFailure);
  item.querySelector(".download").onclick = () =>
    downloadTranscript(summary.id, format.value).catch(reportFailure);
  item.querySelector(".delete").onclick = () => removeTranscript(summary.id).catch(reportFailure);
  return item;
}

function formatOption(format) {
  const option = document.createElement("option");
  option.value = format;
  option.textContent = format.toUpperCase();
  return option;
}

async function renderStored(id, format) {
  const record = await loadTranscript(id);
  if (record == null) throw new Error(`Transcript ${id} is no longer stored`);
  return renderTranscript(record, format);
}

async function copyTranscript(id, format, button) {
  const { content } = await renderStored(id, format);
  await navigator.clipboard.writeText(content);
  const label = button.textContent;
  button.textContent = chrome.i18n.getMessage("copied");
  setTimeout(() => {
    button.textContent = label;
  }, COPIED_LABEL_MS);
}

async function downloadTranscript(id, format) {
  const { filename, mimeType, content } = await renderStored(id, format);
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const link = document.createElement("a");
  // Left unrevoked on purpose: revoking races the download that the click just
  // started, and the URL dies with the popup a moment later anyway.
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

async function removeTranscript(id) {
  if (!confirm(chrome.i18n.getMessage("confirmDelete"))) return;
  await deleteTranscript(id);
  await refreshLibrary();
}
