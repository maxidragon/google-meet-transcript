/**
 * Reads Google Meet's on-screen captions and hands them to the service worker,
 * which is what actually keeps the transcript. This script only looks at the
 * page: it holds no state worth losing when the meeting tab is reloaded.
 *
 * Meet ships obfuscated class names that change without notice, so every lookup
 * tries the selectors that work today and falls back to the page structure — a
 * caption line is an avatar, a name and some text inside a polite live region —
 * which has outlived several Meet redesigns.
 */
(() => {
  const MESSAGE = globalThis.MEET_TRANSCRIPT_MESSAGES;

  const CAPTION_POLL_INTERVAL_MS = 400;
  const CAPTION_CONTAINER_SELECTORS = ['div[jsname="dsyhDe"]', ".a4cQT"];
  const CAPTION_TEXT_SELECTORS = ['div[jsname="tgaKEf"]', ".iOzk7", ".bh44bd"];
  const SPEAKER_NAME_SELECTORS = [".zs7s8d", ".KcIKyf", ".jxFHg"];
  const ANCESTOR_SEARCH_DEPTH = 4;

  const CAPTIONS_BUTTON_LABEL = /captions|napisy/i;
  const CAPTIONS_CURRENTLY_ON_LABEL = /turn off|wyłącz/i;

  // Caption lines are identified by the element they live in. The page-load
  // prefix keeps ids from a reloaded tab distinct from the ones the service
  // worker recorded before the reload.
  const pageLoadId = crypto.randomUUID().slice(0, 8);
  const blockIdsByElement = new WeakMap();
  let nextBlockNumber = 1;

  let pollTimer = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case MESSAGE.startReading:
        turnOnCaptions();
        startReading();
        sendResponse(readPageState());
        return;
      case MESSAGE.stopReading:
        stopReading();
        sendResponse(readPageState());
        return;
      case MESSAGE.getPageState:
        sendResponse(readPageState());
        return;
      default:
        sendResponse({ error: `Unknown message type: ${message.type}` });
    }
  });

  resumeReadingIfTabIsRecording();

  // A reload of the meeting tab leaves the recording running in the service
  // worker; this picks the reading back up where the old page left off.
  function resumeReadingIfTabIsRecording() {
    chrome.runtime
      .sendMessage({ type: MESSAGE.isTabRecording })
      .then((response) => {
        if (response?.recording === true) startReading();
      })
      .catch((error) => console.warn("Meet Transcript could not reach the recorder", error));
  }

  function startReading() {
    if (pollTimer != null) return;
    pollTimer = setInterval(sendCaptions, CAPTION_POLL_INTERVAL_MS);
  }

  function stopReading() {
    if (pollTimer == null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function sendCaptions() {
    const container = findCaptionContainer();
    if (container == null) return;
    const blocks = readCaptionBlocks(container);
    if (blocks.length === 0) return;
    chrome.runtime
      .sendMessage({ type: MESSAGE.captionBlocks, blocks })
      .then((response) => {
        // The recording was stopped elsewhere, or the worker forgot this tab.
        if (response?.recording === false) stopReading();
      })
      .catch((error) => {
        stopReading();
        console.error("Meet Transcript stopped reading captions", error);
      });
  }

  function readPageState() {
    const button = findCaptionsButton();
    return {
      meetingCode: location.pathname.replace(/^\//, ""),
      title: document.title.replace(/^Meet\s*[–—-]\s*/, "").trim(),
      captionsButton: button == null ? "notFound" : areCaptionsOn(button) ? "on" : "off",
    };
  }

  /** @returns {Element | null} the element Meet renders caption lines into. */
  function findCaptionContainer() {
    for (const selector of CAPTION_CONTAINER_SELECTORS) {
      const container = document.querySelector(selector);
      if (container != null) return container;
    }
    const liveRegions = [...document.querySelectorAll('[aria-live="polite"]')];
    const withAvatars = liveRegions.filter((region) => region.querySelector("img") != null);
    return withAvatars[withAvatars.length - 1] ?? null;
  }

  /** @returns {{ blockId: string, speaker: string | null, text: string }[]} oldest line first. */
  function readCaptionBlocks(container) {
    const textElements = container.querySelectorAll(CAPTION_TEXT_SELECTORS.join(","));
    if (textElements.length > 0) {
      return [...textElements].map(blockFromTextElement).filter((block) => block != null);
    }
    return [...container.querySelectorAll("img")]
      .map((avatar) => blockFromAvatar(avatar, container))
      .filter((block) => block != null);
  }

  function blockFromTextElement(textElement) {
    const text = elementText(textElement);
    if (text === "") return null;
    const blockRoot =
      ancestorWithSpeakerName(textElement) ?? textElement.parentElement ?? textElement;
    return { blockId: blockIdOf(blockRoot), speaker: readSpeakerName(blockRoot, text), text };
  }

  function blockFromAvatar(avatar, container) {
    const blockRoot = ancestorWithTwoLines(avatar, container);
    if (blockRoot == null) return null;
    const [speaker, ...spoken] = elementText(blockRoot).split("\n");
    const text = spoken.join(" ").trim();
    if (text === "") return null;
    return { blockId: blockIdOf(blockRoot), speaker: speaker.trim(), text };
  }

  function ancestorWithSpeakerName(element) {
    const speakerSelector = SPEAKER_NAME_SELECTORS.join(",");
    let candidate = element.parentElement;
    for (let depth = 0; depth < ANCESTOR_SEARCH_DEPTH && candidate != null; depth += 1) {
      if (candidate.querySelector(speakerSelector) != null) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function ancestorWithTwoLines(element, container) {
    let candidate = element.parentElement;
    for (let depth = 0; depth < ANCESTOR_SEARCH_DEPTH && candidate != null; depth += 1) {
      if (candidate === container) return null;
      if (elementText(candidate).includes("\n")) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function readSpeakerName(blockRoot, captionText) {
    const named = blockRoot.querySelector(SPEAKER_NAME_SELECTORS.join(","));
    const namedText = named == null ? "" : elementText(named);
    if (namedText !== "") return namedText;
    const firstLine = elementText(blockRoot).split("\n")[0].trim();
    if (firstLine === "" || captionText.startsWith(firstLine)) return null;
    return firstLine;
  }

  function blockIdOf(element) {
    const known = blockIdsByElement.get(element);
    if (known != null) return known;
    const blockId = `${pageLoadId}-${nextBlockNumber}`;
    nextBlockNumber += 1;
    blockIdsByElement.set(element, blockId);
    return blockId;
  }

  function elementText(element) {
    return (element.innerText ?? element.textContent ?? "").trim();
  }

  /**
   * Meet only renders caption text when its own captions are switched on. The
   * toggle carries no stable id or class — its accessible label is the only
   * thing Meet keeps meaningful, hence matching both interface languages.
   */
  function findCaptionsButton() {
    const buttons = document.querySelectorAll("button[aria-label], [role='button'][aria-label]");
    for (const button of buttons) {
      if (CAPTIONS_BUTTON_LABEL.test(button.getAttribute("aria-label"))) return button;
    }
    return null;
  }

  function areCaptionsOn(button) {
    const pressed = button.getAttribute("aria-pressed");
    if (pressed != null) return pressed === "true";
    return CAPTIONS_CURRENTLY_ON_LABEL.test(button.getAttribute("aria-label"));
  }

  function turnOnCaptions() {
    const button = findCaptionsButton();
    if (button == null || areCaptionsOn(button)) return;
    button.click();
  }
})();
