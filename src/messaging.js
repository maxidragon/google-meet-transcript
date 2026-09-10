/**
 * Message types shared by the popup, the service worker and the content script.
 *
 * This assigns a global instead of exporting: the content script must be a
 * classic script (an ES module content script would have to be pulled in with a
 * dynamic import, which a page's Content-Security-Policy can refuse), while the
 * popup and the service worker are modules. A global is the one shape all three
 * can read from a single definition.
 */
globalThis.MEET_TRANSCRIPT_MESSAGES = Object.freeze({
  /** popup → service worker */
  getStatus: "getStatus",
  startCapture: "startCapture",
  stopCapture: "stopCapture",
  /** popup → content script */
  getPageState: "getPageState",
  /** content script → service worker */
  captionBlocks: "captionBlocks",
  isTabRecording: "isTabRecording",
  /** service worker → content script */
  startReading: "startReading",
  stopReading: "stopReading",
});
