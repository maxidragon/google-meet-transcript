import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupConsecutiveBySpeaker,
  renderTranscript,
} from "../src/session/transcriptFormats.js";

const MEETING_START_MS = new Date("2026-03-04T09:00:00Z").getTime();

function record(entries) {
  return {
    id: "session-1",
    meetingCode: "abc-defg-hij",
    title: "Planowanie sprintu",
    startedAtMs: MEETING_START_MS,
    endedAtMs: MEETING_START_MS + 60_000,
    language: "pl",
    entries,
  };
}

describe("renderTranscript", () => {
  it("stamps every plain-text line with the time elapsed since the meeting started", () => {
    const { content } = renderTranscript(
      record([
        { speaker: "Ada", text: "zaczynajmy", startedAtMs: MEETING_START_MS + 5_000 },
        { speaker: "Grace", text: "sure", startedAtMs: MEETING_START_MS + 3_725_000 },
      ]),
      "txt",
    );

    assert.match(content, /\[00:00:05\] Ada: zaczynajmy/);
    assert.match(content, /\[01:02:05\] Grace: sure/);
  });

  it("names the file after the meeting code and start time", () => {
    const { filename } = renderTranscript(record([]), "md");

    assert.match(filename, /^abc-defg-hij-\d{8}-\d{4}\.md$/);
  });

  it("ends a WebVTT cue where the next line starts", () => {
    const { content } = renderTranscript(
      record([
        { speaker: "Ada", text: "jeden", startedAtMs: MEETING_START_MS },
        { speaker: "Grace", text: "two", startedAtMs: MEETING_START_MS + 800 },
      ]),
      "vtt",
    );

    assert.match(content, /00:00:00\.000 --> 00:00:00\.800\n<v Ada>jeden/);
  });

  it("writes the spoken lines into JSON unchanged", () => {
    const entries = [{ speaker: "Ada", text: "wyślemy jutro", startedAtMs: MEETING_START_MS }];
    const { content } = renderTranscript(record(entries), "json");

    assert.deepEqual(JSON.parse(content).entries, entries);
  });

  it("rejects a format it cannot render", () => {
    assert.throws(() => renderTranscript(record([]), "docx"), /Unsupported transcript format/);
  });
});

describe("groupConsecutiveBySpeaker", () => {
  it("joins the lines of one uninterrupted turn into a single paragraph", () => {
    const grouped = groupConsecutiveBySpeaker([
      { speaker: "Ada", text: "zaczynajmy", startedAtMs: MEETING_START_MS },
      { speaker: "Ada", text: "od budżetu", startedAtMs: MEETING_START_MS + 4_000 },
      { speaker: "Grace", text: "okay", startedAtMs: MEETING_START_MS + 9_000 },
    ]);

    assert.deepEqual(
      grouped.map((entry) => [entry.speaker, entry.text, entry.startedAtMs - MEETING_START_MS]),
      [
        ["Ada", "zaczynajmy od budżetu", 0],
        ["Grace", "okay", 9_000],
      ],
    );
  });
});
