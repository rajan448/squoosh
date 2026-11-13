# HEIC input decoding fix plan

Date: 2026-11-13
Status: Core fix implemented and verified; reproduction with the reported image pending.
Owner: Mary, Business Analyst

## Problem and intended outcome

A user opening a HEIC image (reported as “hiec”) receives:
`Source decoding error: Error: Couldn't decode image`.

Enable users to open supported HEIC/HEIF still images, preview and process them,
and export through existing encoders. Keep image processing entirely local,
consistent with the repository's privacy promise.

## Findings and confidence

Confirmed from repository inspection:

- `src/client/lazy-app/util/index.ts`: `sniffMimeType` examines only the first
  16 bytes. Its signature table has no HEIC/HEIF entries, and `ImageMimeTypes`
  is derived from that table.
- `src/client/lazy-app/Compress/index.tsx`: `decodeImage` has worker fallbacks
  for AVIF, WebP, JXL, WebP2 and QOI, but none for HEIC. Unrecognized input
  goes to `builtinDecode`; non-abort failures become the generic error above.
- `builtinDecode` selects `createImageBitmap` when available; otherwise it
  uses an image element. It does not retry the image-element path if bitmap
  decoding fails.
- `canDecodeImageType` tests picture-source selection, not successful decoding
  of the submitted file. Its result must not prevent a HEIC fallback after an
  actual native decode failure.
- `src/client/lazy-app/worker-bridge/index.ts` already supports queued work,
  abort-triggered worker termination, and idle cleanup.
- `lib/feature-plugin.js` generates worker APIs from
  `src/features/*/**/worker/*.ts`; generated files should not be edited by hand.
- `src/sw/to-cache.ts` controls codec caching. CI currently runs the build;
  `package.json` has no test command.

Likely explanation: HEIC reaches native decoding, which fails, and there is no
fallback. The exact failing file, browser and OS have not been supplied, so
file corruption or an unsupported HEIF variant remain unverified possibilities.
No runtime reproduction has been performed.

## Scope

Support HEVC-backed HEIC still images, including common iPhone files and HEIF
containers carrying supported HEVC image content. Decode the primary image to
the existing 8-bit RGBA `ImageData` pipeline. Handle orientation once and
document color conversion behavior. Do not imply support for every codec that
can be stored in HEIF.

Excluded: HEIC encoding, batch import, sequence playback, auxiliary depth/gain
map processing, HDR preservation and metadata preservation. For multi-image
containers, select the declared primary image rather than a thumbnail or the
first arbitrary entry.

## Implementation sequence

1. **Establish fixtures and the decoder choice.** Reproduce with an independently
   sourced HEIC fixture in a target browser and later add the reported file if
   available. Record browser/OS and original errors. Spike `libheif-js`'s browser
   WASM bundle inside the existing Rollup worker. Verify its pinned build includes
   HEVC decoding, exposes primary-image selection, applies transforms correctly,
   and releases resources. Verify bundled dependencies, license notices,
   security maintenance, runtime compatibility and emitted asset size before
   selecting the exact version. If its JS API cannot meet primary-image or
   transform requirements, use a minimal WASM adapter over libheif's C API.

2. **Recognize containers safely.** Extend `sniffMimeType` and its return type
   with a bounded ISO-BMFF `ftyp` parser that inspects major and compatible
   brands. Read enough of the declared box to inspect compatible brands safely;
   validate lengths and truncation, cap inspection, and never read a claimed
   huge box without a bound. Preserve AVIF classification and precedence.
   Generic HEIF container brands alone must not assert an HEVC payload.
   Treat filenames and MIME labels as hints, with byte evidence taking
   precedence; empty MIME, uppercase extensions and renamed files must work.

3. **Add worker decoding.** Add
   `src/features/decoders/heic/worker/heicDecode.ts` and an isolated codec adapter
   with typings. Load the decoder dynamically on demand, cache successful module
   initialization, and allow retry after initialization failure. Decode the
   primary still image directly to RGBA without an intermediate JPEG or PNG.
   Check dimensions and multiplication overflow before allocating buffers;
   establish a documented pixel/memory limit using representative mobile
   measurements. Release decoder handles on both success and failure. Reuse
   worker cancellation and regenerate bridge/API files through the build.

4. **Route imports and preserve useful errors.** Add HEIC routing in
   `Compress/index.tsx`. Try native decoding when appropriate, optionally retry
   via an image element when bitmap decoding fails, then fall back to the HEIC
   worker after actual native failure. When native support is unavailable,
   route directly to the worker. Always propagate `AbortError` without trying
   another decoder or showing a snackbar. Distinguish unsupported codec,
   invalid input, size limit and decoder asset-loading failures when evidence
   permits; retain the underlying cause for diagnosis without logging image
   bytes. Show concise messages without repeated `Error:` prefixes.

5. **Integrate packaging and offline use.** Ensure Rollup emits the decoder and
   any WASM assets with valid URLs and includes them in service-worker caching.
   Choose background caching consistent with existing codecs, keeping decoder
   execution out of the initial main-thread path. Verify an installed, fully
   cached app can decode offline and that an uncached offline decoder produces
   a clear load failure. Check both file-picker and drag-and-drop import.

6. **Validate and document supported behavior.** Add focused automated detection
   and routing tests with the smallest suitable harness, fixture-based worker
   integration coverage, and browser checks. Run `npm run build` and the new
   targeted tests; record browser results and measured loading/memory behavior.
   Update input-format documentation with supported still-image behavior and
   known color/HDR limits.

## Acceptance criteria

- Valid supported HEIC fixtures open through picker and drag-and-drop, show
  correct dimensions and orientation, resize/rotate, and export as JPEG,
  PNG and WebP with correct extensions.
- Detection covers major and compatible brands, absent/wrong MIME labels,
  uppercase names and renamed files. AVIF remains on its existing path.
- Both native success and forced native failure are exercised; the latter
  reaches the worker even when capability detection reports support.
- Multi-image fixtures select the primary image; thumbnails are not selected.
  Include portrait/rotated, grid/tiled and representative 10-bit fixtures;
  validate conversion to the documented 8-bit output against reference images.
- Truncated, corrupt, unsupported-codec and excessive-dimension inputs fail
  predictably without leaving the UI loading. A valid image still opens after
  each failure.
- Canceling or replacing input during module loading or decoding produces no
  stale preview or error snackbar, and the next image loads successfully.
- Repeated imports release image handles and avoid unbounded memory growth.
- PNG, JPEG, WebP, AVIF, JXL, QOI and SVG import smoke checks pass.
- Production build succeeds; decoder assets load from the deployed path and
  offline decoding succeeds after caching. No image data leaves the device.

## Open evidence to collect during implementation

- The user's exact failing image and browser/OS, when available.
- The decoder build/API's primary-image, orientation, color and cleanup behavior.
- Representative desktop/mobile decode time, peak memory and final bundle size;
  use these measurements to set limits rather than inventing thresholds.

## Sources and project setup

- [libheif-js documentation](https://github.com/catdad-experiments/libheif-js):
  documents browser WASM bundles and RGBA decoding. Browser integration still
  needs a spike against this repository's build.
- [libheif documentation](https://github.com/strukturag/libheif): documents
  HEVC decoding, primary-image access, transforms and resource release.
- No project `_bmad` configuration or customizations were present. The analyst
  defaults were loaded manually after its resolver could not run; this plan
  uses `docs/plans/` because no planning artifact location was configured.

## Implementation results

- Added bounded HEIC/HEIF/AVIF container detection, native-to-worker fallback,
  primary-image RGBA decoding, cleanup, meaningful errors and offline caching.
- Pinned libheif-js 1.23.5 and distributed its license notices.
- `npm run build` and all 14 `npm run test:heic` tests pass; CI runs both.
- Verified the upstream libheif example at 1280 x 854 and generated fixtures
  covering pixels, primary selection and container rotation.
- Production Chrome checks pass for file picker, drag/drop, JPEG/PNG/WebP
  export, editor rotation and offline reload/decode after background caching.
- Wide-gamut ICC conversion and HDR preservation are unsupported and documented.
  The 64-megapixel fallback limit bounds RGBA output to 256 MiB; mobile peak
  memory, grid, mirror/crop and 10-bit reference coverage remain unverified.
- The reported image and browser/OS are still unavailable for exact reproduction.
