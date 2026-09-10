# Meet Transcript

A Chrome extension that turns Google Meet's own live captions into a transcript you can read,
copy or download. Polish and English meetings both work.

Nothing is recorded and nothing is uploaded: the extension reads the caption text Meet already
draws on the page, and keeps the result in the browser's local storage.

## Requirements

- Chrome 130 or newer.
- Captions switched on in the meeting. Starting a recording switches them on for you; the
  extension cannot read anything while they are off.
- The transcript's language is whatever Meet's caption language is set to
  (Meet → Settings → Captions). Meet transcribes one language at a time, so a meeting that
  switches between Polish and English is only transcribed in the language Meet is set to.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Reload any Google Meet tab that was already open.

## Use

1. Join a meeting and open the extension from the toolbar.
2. **Start recording**. The toolbar icon shows `REC` while it runs.
3. **Stop recording** when the meeting ends. Closing the meeting tab also stops and saves it.

Saved transcripts are listed in the popup and can be copied or downloaded as:

| Format | What it is |
| --- | --- |
| `TXT` | `[00:12:03] Anna Kowalska: …`, one line per turn |
| `MD` | the same with a heading and speakers in bold |
| `JSON` | every line with its speaker and timestamp, for further processing |
| `VTT` | WebVTT subtitles, for playing alongside a recording |

A recording survives reloading the meeting tab. It does not survive quitting Chrome — stop the
recording before you close the browser, or the last few seconds may be missing.

## How it works

- `src/capture/content.js` runs in the meeting tab and does nothing but read the caption lines
  on screen every 400 ms. Meet rewrites a caption line while it is being spoken — growing it,
  re-recognising earlier words, and dropping words off the front once the line is too long —
  so each line is sent as a snapshot rather than as final text.
- `src/background/recorder.js` owns the transcript: it folds those snapshots back into whole
  utterances (`src/session/captionText.js`, `src/session/transcriptSession.js`) and writes them
  to `chrome.storage.local`. Keeping the session here is what lets a reload of the meeting tab
  leave the recording running.
- `src/popup/` starts and stops recordings and exports what was stored.

Meet's class names are obfuscated and change without notice. Every lookup tries the selectors
that work today and falls back to the page structure — a caption line is an avatar, a name and
some text inside a polite live region — which has outlived several Meet redesigns.

## Limitations

- The transcript is only as good as Meet's captions, including how it spells names and numbers.
- Speaker names are whatever Meet displays, so you appear as *You* / *Ty*.
- A Meet redesign can still break caption reading. The symptom is a recording that stays at
  zero lines while captions are visibly on screen.
- Transcripts share Chrome's 10 MB local storage quota — roughly a hundred hour-long meetings.
  The popup says so if a save fails; delete old transcripts to free space.

Recording other people, even as text, is theirs to know about. Tell the meeting.

## Development

```sh
npm test
```

The tests cover the parts that are hard to get right and easy to break: folding caption
snapshots into utterances, detecting the language, and rendering the export formats. Reading
Meet's DOM is verified by hand against a real meeting.
