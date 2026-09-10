/**
 * @typedef {import("./transcriptSession.js").TranscriptEntry} TranscriptEntry
 * @typedef {{
 *   id: string,
 *   meetingCode: string,
 *   title: string,
 *   startedAtMs: number,
 *   endedAtMs: number | null,
 *   language: string | null,
 *   entries: TranscriptEntry[]
 * }} TranscriptRecord
 */

export const TRANSCRIPT_FORMATS = ["txt", "md", "json", "vtt"];

const UNKNOWN_SPEAKER = "?";

// Meet gives no end time for a caption line, so a trailing cue is stretched to
// roughly how long the words take to say.
const MILLISECONDS_PER_WORD = 400;
const MINIMUM_CUE_MILLISECONDS = 1500;

/**
 * Render a stored transcript as a downloadable file.
 *
 * @param {TranscriptRecord} record
 * @param {"txt" | "md" | "json" | "vtt"} format
 * @returns {{ filename: string, mimeType: string, content: string }}
 */
export function renderTranscript(record, format) {
  switch (format) {
    case "txt":
      return file(record, "txt", "text/plain", renderPlainText(record));
    case "md":
      return file(record, "md", "text/markdown", renderMarkdown(record));
    case "json":
      return file(record, "json", "application/json", `${JSON.stringify(record, null, 2)}\n`);
    case "vtt":
      return file(record, "vtt", "text/vtt", renderWebVtt(record));
    default:
      throw new Error(`Unsupported transcript format: ${format}`);
  }
}

function file(record, extension, mimeType, content) {
  return { filename: `${transcriptSlug(record)}.${extension}`, mimeType, content };
}

function transcriptSlug(record) {
  const startedAt = new Date(record.startedAtMs);
  const stamp = [
    startedAt.getFullYear(),
    pad(startedAt.getMonth() + 1),
    pad(startedAt.getDate()),
    "-",
    pad(startedAt.getHours()),
    pad(startedAt.getMinutes()),
  ].join("");
  const code = record.meetingCode === "" ? "meet" : record.meetingCode;
  return `${code}-${stamp}`;
}

function renderPlainText(record) {
  const lines = [
    record.title,
    `${new Date(record.startedAtMs).toLocaleString()} · ${record.meetingCode}`,
    "",
  ];
  for (const entry of groupConsecutiveBySpeaker(record.entries)) {
    lines.push(
      `[${formatElapsed(entry.startedAtMs - record.startedAtMs)}] ${entry.speaker ?? UNKNOWN_SPEAKER}: ${entry.text}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(record) {
  const lines = [`# ${record.title}`, ""];
  lines.push(`- Meeting: \`${record.meetingCode}\``);
  lines.push(`- Started: ${new Date(record.startedAtMs).toLocaleString()}`);
  if (record.language != null) lines.push(`- Language: ${record.language}`);
  lines.push("");
  for (const entry of groupConsecutiveBySpeaker(record.entries)) {
    const elapsed = formatElapsed(entry.startedAtMs - record.startedAtMs);
    lines.push(`**${entry.speaker ?? UNKNOWN_SPEAKER}** \`${elapsed}\`  `);
    lines.push(entry.text);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderWebVtt(record) {
  const lines = ["WEBVTT", ""];
  record.entries.forEach((entry, index) => {
    const start = entry.startedAtMs - record.startedAtMs;
    const end = cueEnd(entry, record.entries[index + 1], record.startedAtMs);
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`);
    lines.push(`<v ${entry.speaker ?? UNKNOWN_SPEAKER}>${entry.text}`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

function cueEnd(entry, nextEntry, sessionStartedAtMs) {
  const start = entry.startedAtMs - sessionStartedAtMs;
  const spoken = Math.max(
    MINIMUM_CUE_MILLISECONDS,
    entry.text.split(/\s+/).length * MILLISECONDS_PER_WORD,
  );
  if (nextEntry == null) return start + spoken;
  return Math.min(start + spoken, nextEntry.startedAtMs - sessionStartedAtMs);
}

/**
 * Meet rotates caption lines while one person keeps talking, so a single turn
 * arrives as several entries. Joining them back into one paragraph is what makes
 * the exported transcript readable.
 *
 * @param {TranscriptEntry[]} entries
 * @returns {TranscriptEntry[]}
 */
export function groupConsecutiveBySpeaker(entries) {
  const grouped = [];
  for (const entry of entries) {
    const previous = grouped[grouped.length - 1];
    if (previous != null && previous.speaker === entry.speaker) {
      grouped[grouped.length - 1] = { ...previous, text: `${previous.text} ${entry.text}` };
      continue;
    }
    grouped.push(entry);
  }
  return grouped;
}

export function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatVttTime(milliseconds) {
  const clamped = Math.max(0, milliseconds);
  return `${formatElapsed(clamped)}.${String(clamped % 1000).padStart(3, "0")}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
