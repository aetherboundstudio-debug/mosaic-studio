# Mosaic Studio

A creative studio that runs entirely in your browser. Six real tools — photo
development, painting, layout design, motion titles, video trimming and PDF
assembly — with no account, no upload, and no network round-trip. Your files
never leave the machine.

Optional AI generation can be switched on by pasting in your own API key. Until
you do, every tool works the same, just without the generate button.

---

## The tools

### Photo — non-destructive development

A full adjustment stack applied as a pipeline, not baked into the pixels:
exposure, contrast, highlights, shadows, whites, blacks, temperature, tint,
vibrance, saturation, clarity, sharpen, blur, vignette, grain and fade, plus a
draggable tone curve. 12 one-click looks. Live RGB histogram. Press and hold to
compare against the original.

Crop with aspect presets, straighten, 90° rotation and flips. A magic-wand
cutout tool selects by colour similarity — contiguous or global, with edge
sampling for one-shot background removal — then feather or hand-paint the mask.

Export to PNG, JPEG or WebP at any quality and scale.

### Paint — layered raster painting

A real layer stack: add, duplicate, reorder, merge down, rename, hide, set
opacity and pick from 15 blend modes. Five brushes (pen, marker, pencil,
airbrush, eraser) with size, opacity, hardness, smoothing and pointer-pressure
support. Bucket fill with tolerance, eyedropper, line, rectangle, ellipse, text
and a mirror mode. Deep undo/redo, canvas resize, image import, and transparent
PNG export.

### Design — object-based layout

Text, shapes and images as editable objects on a page. Drag, resize, rotate,
snap to guides, align, distribute and reorder. Nine page presets (A4, Instagram
post and story, YouTube thumbnail, poster and more) and five starting templates.
Six font stacks with weight, tracking, line height and wrapping. Exports to PNG,
JPEG, WebP or a real PDF.

### Motion — keyframed animated titles

12 animation types across 5 easing curves, composed on a timeline with a
scrubber and transport controls. Six themes, four output sizes. Renders to WebM
via MediaRecorder, to an animated GIF, or to a single PNG frame.

### Video — trim and grade

Load a clip and get a 12-frame filmstrip, draggable in/out handles and a
scrubber. Apply a six-stop colour grade, change speed, mute the audio, and pick
an output frame size. Exports an actual trimmed file — WebM through
MediaRecorder, a GIF, or a grabbed PNG frame.

### PDF — assemble and extract

Open several PDFs at once and see every page rendered as a thumbnail via
pdf.js. Reorder, rotate, duplicate, reverse and remove pages across documents,
then write the result out with pdf-lib. Export the whole document, just the
selected pages, or every page as a PNG. Images can be turned into a PDF too.

### AI panel — bring your own key

Every canvas tool has an AI panel that stays inert and clearly labelled until
you add a provider. Supports OpenAI-compatible endpoints and custom URLs. The
key is stored locally in your browser and sent only to the provider you
configured. Generated images drop straight onto the canvas you're working in.

---

## Everything else

- **Projects are really saved.** IndexedDB stores the actual document, its
  assets and a thumbnail — not just a filename. Reopen a project and your work
  is there.
- **Works offline.** A service worker caches the app shell, and there's an
  install prompt for standalone use.
- **Responsive, not a phone frame.** Below 900px: topbar, stage and a bottom nav
  with the inspector as a slide-up sheet. Above it: a left icon rail, the stage,
  and a persistent right inspector.
- **Dark and light themes**, remembered between sessions.
- **Deep links.** Every tool has its own route, and `#/photo?project=<id>` opens
  a saved project directly.

### Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` | Undo / redo |
| `Ctrl/Cmd + S` | Save project |
| `Ctrl/Cmd + E` | Export |
| `[` / `]` | Brush smaller / larger (Paint) |
| `B` / `E` | Brush / eraser (Paint) |
| Arrow keys, `Delete` | Nudge, remove selection (Design) |
| `Space` | Play / pause (Motion, Video) |
| `I` / `O` | Set in / out point (Video) |

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # typecheck, then build to dist/
npm run preview  # serve the production build
```

### Tests

```bash
npm test             # typecheck + pipeline + routes
npm run test:pipeline  # imaging maths against a real canvas
npm run test:routes    # render every route headlessly
```

`test:pipeline` builds the imaging modules for Node and runs them against
`@napi-rs/canvas`, a genuine Skia-backed 2D context — so tone curves,
adjustments, geometry, masks, layer compositing, flood fill and template
rendering are checked on actual pixels. `test:routes` boots the production
bundle in jsdom, visits all ten routes and fails on any uncaught error.

### Deploying

`.github/workflows/deploy.yml` typechecks and tests on every push and pull
request, then publishes `dist/` to GitHub Pages from `main`. Enable it under
**Settings → Pages → Source → GitHub Actions**.

The build uses a relative base path, so the output also works from any static
host or a plain subdirectory.

---

## How it's built

Vite 8 and TypeScript 5.9 in strict mode, with vanilla DOM — no UI framework.
The only runtime dependencies are `pdf-lib`, `pdfjs-dist` and `gifenc`, and all
three are code-split so they load on demand; the initial JS and CSS come to
about 60 KB.

```
src/
  core/      dom, image, record, storage, history, router, UI primitives
  shell/     app shell, navigation, home / projects / learn / settings
  tools/     photo, draw, design, motion, video, pdf (+ shared helpers)
  ai/        provider registry and the BYO-key panel
  styles/    design system and layout
scripts/     pipeline and route tests
legacy/      the original single-file prototype, kept for reference
```

Shared foundations the tools build on: a common layer model, snapshot-based
undo/redo, IndexedDB project persistence, a shared export dialog handling PNG,
JPEG and WebP at any quality and scale, and `core/record.ts` for WebM and GIF
encoding. PDF output goes through pdf-lib.

---

## Privacy

Everything runs locally. Images, videos and PDFs are read with the File API and
processed on canvas in the page; nothing is uploaded. Projects live in your
browser's IndexedDB. The only network request the app can ever make is to an AI
provider you configure yourself.
