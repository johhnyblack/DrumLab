# DrumLab agent handoff

## Start here

Read this file, `README.md` (Chinese) or `README.en.md`, `VALIDATION.md`, and
`AUDIVERIS_VALIDATION.md` before changing behavior. Inspect `git status` first and
preserve existing work. This is a local, single-user electronic drum practice app,
not a hosted multi-user service. The interface is Chinese; communicate in the
user's language. Keep product copy nontechnical.

This handoff describes the current implementation. Update it when architecture,
persistence, setup or validation workflows change. Do not present historical test
results as freshly executed checks. Delegate only when the user or applicable
instructions request agent delegation.

## Repository map

- `src/main.tsx`: app state, importing/editing, recording, practice controls and library integration.
- `src/model.ts`: score validation, precise beat values, import reset baseline, WAV encoding and PDF cursor interpolation.
- `src/engine.ts`: live Web Audio transport, sample loading/choking and offline audio rendering.
- `src/sounds.ts`: kit choices and original AVL five-layer velocity boundaries.
- `src/PdfPlayer.tsx`: rasterized original PDF, OMR locations, manual boxes and clock-driven cursor.
- `src/VideoExport.tsx`, `src/video.ts`: export dialog, explicit-timestamp frames and local MP4/WebM encoding.
- `src/projects.ts`: serialized/debounced saves, revision tracking, recovery journal and project media.
- `src/ProjectSidebar.tsx`: recent project groups, search, rename/delete and responsive drawer.
- `backend/main.py`: import/audio/PDF endpoints and production static serving.
- `backend/score.py`: safe MusicXML/MXL parsing with rational timing.
- `backend/pdf_map.py`: normalized ORIGINAL-page positions from Audiveris `.omr` ZIPs.
- `backend/projects.py`: local SQLite library, separate PDF/audio blobs and revision checks.
- `backend/audio.py`: conservative DSP with original frame/channel/rate preservation.
- `scripts/prepare_drum_samples.py`: reproducible selection/conversion of official AVL recordings.
- `scripts/subset_font.py`: OFL UI font generation; includes common Chinese project-name characters.
- `public/sounds/`: 80 licensed recordings, provenance manifest and license.
- `public/licenses/`, `public/fonts/`: third-party notices and licenses.
- `tests/`: Python API/DSP/library tests, Playwright flows and a generated two-page PDF fixture.
- `dist/`: TRACKED production build; FastAPI serves it directly.

## Environment and commands

Python 3.12+, Node.js 22.12+ (validated with Python 3.12 and Node 24).
First setup: `python3 run.py --setup --open`; Windows: `py run.py --setup --open`.
Subsequent launch: `python3 run.py --open`. Default address: `127.0.0.1:8765`.
Windows native Python uses `.venv/Scripts/python.exe`; Linux/WSL uses `.venv/bin/python`.
`Start-DrumLab-WSL.bat` assumes the default WSL distribution is the one configured
for this checkout. It does not install WSL or Audiveris on a fresh clone.

Development: `.venv/bin/python -m uvicorn backend.main:app --port 8765 --reload`
and `npm run dev` in separate terminals. Vite proxies `/api` to 8765; licensed
sounds and notices are served from `public/` in dev and copied to `dist/` on build.

Checks appropriate to a change:

```sh
npm test
.venv/bin/python -m pytest -q
npm run build
```

Browser tests need a separate server with NO configured OMR engine, because one
case deliberately checks the no-engine fallback. Linux/WSL example:

```sh
# Terminal 1: avoid the user's live port and real data directory.
AUDIVERIS_BIN= DRUMLAB_PROJECTS_DIR=/tmp/drumlab-e2e \
  .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8766
# Terminal 2:
npx playwright install chromium
DRUMLAB_TEST_URL=http://127.0.0.1:8766 npx playwright test
```

Playwright's `beforeEach` supplies a unique `X-DrumLab-Workspace` for each test.
Keep that isolation. Never clear the user's actual project database for tests.
A real Audiveris check is separate: use an explicitly configured engine and a
legitimately obtained PDF. Test data from third-party scores stays in `.local/`.

Latest recorded suite: 17 frontend + 24 backend + 14 browser = 55 tests. See the
validation reports for dates, evidence and limits. Real hardware latency and a
representative PDF recognition accuracy dataset have NOT been validated.

## Required behavior and data invariants

### Scores, reset and PDF playback

- Imported beat positions must not be quantized to the visible editor grid.
  Parser arithmetic uses `Fraction`; display/playback retains off-grid events.
- Unknown drum mappings stay explicit and block practice until mapped. Never
  invent notes after failed PDF recognition; return the labeled empty correction score.
- Standard MusicXML percussion numbers are one-based. The Audiveris compatibility
  path only applies with exporter provenance AND at least two consistent named
  instrument matches. Do not globally change the offset.
- Reset restores the `importedScore` baseline and must survive project save/reopen.
- Original PDF positions come from `.omr`, not reflowed MusicXML layout. Match the
  full measure count before attaching positions; on mismatch require manual boxes.
- Manual boxes use proportional cursor movement; do not describe that as exact
  notehead alignment. Editing the functional score does not redraw the PDF.
- Keep the PDF page image API; an iframe alone failed in headless Chromium.

### Audio and video

- Live sound timing uses one AudioContext with absolute timestamps, 25 ms scheduling
  and 180 ms lookahead. UI timers must not trigger notes. Preserve stall protection.
- Decoding saved recordings must NOT wait for `AudioContext.resume()`; project
  restoration must work before a user grants autoplay through interaction.
- Preserve original BPM/offset/rate loop math, meters/count-in, source cleanup,
  pending-start cancellation and closed-hat choking of open hats.
- Two kits are REAL AVL recordings, not newly synthesized replacements. Preserve
  five original velocity layers and provenance. The original synthetic kit is an option.
- Video export uses offline audio and explicit frame timestamps through Mediabunny.
  Do not revert to real-time canvas/MediaRecorder capture: measured audio/video
  durations drifted. Verify decoded audio energy, dimensions, duration, moving frames,
  download signatures and cancellation when changing export behavior.
- MP4 is a container, not a promise of H.264 availability. Detect available encoders.
  Keep unsupported formats and missing PDF locations explicit.

### Local projects and user data

- Default library: `.local/projects/main.sqlite3`. It contains score snapshots,
  reset baselines, PDF and audio blobs, thumbnails and practice settings.
- `DRUMLAB_PROJECTS_DIR` overrides the directory. Workspaces isolate test libraries;
  they are NOT authentication. Do not expose this service as multi-user without redesign.
- Every import creates a separate project; switching flushes pending edits and
  restores the destination's media/settings. Never carry another project's recording over.
- Serialize writes and honor revision checks on score and media. Stale windows
  must not silently overwrite newer edits; conflicting recovery snapshots become copies.
- The browser recovery journal protects unfinished SCORE edits, not unsaved audio
  blobs. Show save failures; do not claim media is saved before its upload completes.
- Preserve legacy cache migration, including when the disk library already contains
  projects. Earlier overwritten legacy records and never-persisted attachments cannot be recovered.
- JSON exports still exclude audio. Do not claim they are complete library backups.
- Never delete/migrate the real database without a backup and task authorization.
  Stopping the service then copying the SQLite file is the documented full backup.
- Keep `.local/`, `.tools/`, credentials, personal exports and recordings out of Git.

## Audiveris integration decision

Use an official Audiveris release as an independent OPTIONAL local component.
The current machine uses 5.11.0 unpacked into `.tools/audiveris/`, NOT a fork or
clone of upstream source. Neither the installation nor its caches belong in Git.
Do not prune/fork the recognition engine or embed its source as a shortcut.

`run.py` discovers `.tools/audiveris-drumlab.sh` if it exists. This ignored wrapper
is machine-local and absent on a fresh clone. Explicit `AUDIVERIS_BIN` wins.
Native Windows users must use a native Windows CLI executable; the WSL/Linux
binary is not a native Windows executable.

Current options: `--omr-font Bravura|JazzPerc`, `--omr-small-notes`;
`AUDIVERIS_MUSIC_FONT`, `AUDIVERIS_SMALL_NOTES=true` are backend equivalents.
Percussion switches are always passed. Do not globally use JazzPerc because it
worked for Ophelia. The engine has a 1200-second timeout and recognition always
requires review. Single-score success is not an accuracy benchmark.

## Assets, docs and publishing

Keep README.md and README.en.md consistent, especially persistence and optional
setup. Preserve AVL CC-BY-SA 3.0 + music exception, Noto SIL OFL, and Mediabunny
MPL-2.0 notices/source links. Do not select a license for the app's own source
without the user's decision; it currently has no explicit source-code license.

After UI edits, rebuild `dist/`; remove stale hashed assets and include the new
ones. Public sound/font/license assets and the small generated fixtures are
intentionally tracked. Do not ignore all audio/PDF files. Font regeneration is a
development task requiring fonttools/brotli, not a runtime dependency.

Remote: `https://github.com/johhnyblack/DrumLab.git`, default branch `main`.
Before publishing, inspect remote HEAD, preserve its history, check the staged
file list/ignored data and scan for credentials. Never force-push or publish the
user's local library. Git credentials may be unavailable on this host; the GitHub
connector can publish Git blobs/trees/commits. Keep local and remote histories
aligned, verify the final tree and ref, and do not store connector credentials.

## Bilibili video PDF

`backend/video_pdf.py` fetches public single-part BV videos and stitches vertically scrolling frames into an image PDF. It limits video duration and size and restricts accepted hosts. The result is a visual reconstruction, not MusicXML; users must review stitching and any subsequent OMR. The UI is `src/VideoPdf.tsx`. OpenCV is a backend runtime dependency.

Oversized PDF pages are scaled proportionally only for OMR in `omr_safe_pdf`; original PDF media and normalized coordinates remain unchanged. Video PDF pages use 612-point width to avoid exceeding Audiveris raster limits. Keep the 8-million-pixel bound at 300 DPI to avoid excessive processing time.
