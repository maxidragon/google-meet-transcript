import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCaptionSnapshot,
  createSessionState,
  openEntriesForBlocks,
} from "../src/session/transcriptSession.js";

const MEETING_START_MS = 1_700_000_000_000;

describe("applyCaptionSnapshot", () => {
  it("turns a caption line into an entry stamped with the time it appeared", () => {
    const state = applyCaptionSnapshot(
      createSessionState(),
      [{ blockId: "block-1", speaker: "Ada", text: "dzień dobry" }],
      MEETING_START_MS,
    );

    assert.deepEqual(state.entries, [
      { speaker: "Ada", text: "dzień dobry", startedAtMs: MEETING_START_MS },
    ]);
  });

  it("extends the open entry while the same line keeps growing", () => {
    const first = applyCaptionSnapshot(
      createSessionState(),
      [{ blockId: "block-1", speaker: "Ada", text: "dzień" }],
      MEETING_START_MS,
    );
    const second = applyCaptionSnapshot(
      first,
      [{ blockId: "block-1", speaker: "Ada", text: "dzień dobry wszystkim" }],
      MEETING_START_MS + 900,
    );

    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].text, "dzień dobry wszystkim");
    assert.equal(second.entries[0].startedAtMs, MEETING_START_MS);
  });

  it("starts a new entry when Meet reuses a caption line for another speaker", () => {
    const first = applyCaptionSnapshot(
      createSessionState(),
      [{ blockId: "block-1", speaker: "Ada", text: "dzień dobry" }],
      MEETING_START_MS,
    );
    const second = applyCaptionSnapshot(
      first,
      [{ blockId: "block-1", speaker: "Grace", text: "cześć" }],
      MEETING_START_MS + 2000,
    );

    assert.deepEqual(
      second.entries.map((entry) => [entry.speaker, entry.text]),
      [
        ["Ada", "dzień dobry"],
        ["Grace", "cześć"],
      ],
    );
  });

  it("keeps separate entries for lines shown side by side", () => {
    const state = applyCaptionSnapshot(
      createSessionState(),
      [
        { blockId: "block-1", speaker: "Ada", text: "one" },
        { blockId: "block-2", speaker: "Grace", text: "two" },
      ],
      MEETING_START_MS,
    );

    assert.equal(state.entries.length, 2);
  });

  it("returns the state it was given when the snapshot adds nothing", () => {
    const blocks = [{ blockId: "block-1", speaker: "Ada", text: "dzień dobry" }];
    const first = applyCaptionSnapshot(createSessionState(), blocks, MEETING_START_MS);
    const second = applyCaptionSnapshot(first, blocks, MEETING_START_MS + 400);

    assert.equal(second, first);
  });

  it("ignores a caption line that is still empty", () => {
    const state = applyCaptionSnapshot(
      createSessionState(),
      [{ blockId: "block-1", speaker: "Ada", text: "   " }],
      MEETING_START_MS,
    );

    assert.deepEqual(state.entries, []);
  });
});

describe("openEntriesForBlocks", () => {
  it("keeps only the lines still on screen", () => {
    const state = {
      entries: [],
      openEntryIndexByBlockId: { "page-1": 0, "page-2": 1, "page-3": 2 },
    };

    assert.deepEqual(
      openEntriesForBlocks(state, [
        { blockId: "page-2", speaker: "Ada", text: "still talking" },
        { blockId: "page-3", speaker: "Grace", text: "me too" },
      ]),
      { "page-2": 1, "page-3": 2 },
    );
  });

  it("skips a line that has no entry open yet", () => {
    const state = { entries: [], openEntryIndexByBlockId: {} };

    assert.deepEqual(
      openEntriesForBlocks(state, [{ blockId: "page-9", speaker: "Ada", text: "new" }]),
      {},
    );
  });
});
