import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectLanguage, mergeCaptionText } from "../src/session/captionText.js";

describe("mergeCaptionText", () => {
  it("replaces the stored line with a snapshot that extends it", () => {
    assert.equal(mergeCaptionText("we should", "we should ship it"), "we should ship it");
  });

  it("joins at the overlap when the snapshot has lost words off the front", () => {
    assert.equal(
      mergeCaptionText("so we should ship", "we should ship it today"),
      "so we should ship it today",
    );
  });

  it("appends after a space when the snapshot shares no boundary with the stored line", () => {
    assert.equal(mergeCaptionText("first thought", "second thought"), "first thought second thought");
  });

  it("keeps the stored line when the snapshot is a shortened version of it", () => {
    assert.equal(mergeCaptionText("we should ship it", "we should"), "we should ship it");
  });

  it("treats a boundary shorter than six characters as coincidence rather than overlap", () => {
    assert.equal(mergeCaptionText("zapytam a", "a potem wyślemy"), "zapytam a a potem wyślemy");
  });

  it("returns the snapshot when nothing is stored yet", () => {
    assert.equal(mergeCaptionText("", "dzień dobry"), "dzień dobry");
  });
});

describe("detectLanguage", () => {
  it("reads Polish from diacritics", () => {
    assert.equal(detectLanguage("musimy jeszcze raz przejrzeć te liczby przed wysyłką"), "pl");
  });

  it("reads Polish from common words written without diacritics", () => {
    assert.equal(detectLanguage("nie wiem czy to jest gotowe na jutro rano"), "pl");
  });

  it("reads English from common words", () => {
    assert.equal(detectLanguage("I think that we should ship this on Tuesday"), "en");
  });

  it("reports no language for a sample under twenty characters", () => {
    assert.equal(detectLanguage("dobrze"), null);
  });
});
