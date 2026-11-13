# [Squoosh]!

[Squoosh] is an image compression web app that reduces image sizes through numerous formats.

# Privacy

Squoosh does not send your image to a server. All image compression processes locally.

However, Squoosh utilizes Google Analytics to collect the following:

- [Basic visitor data](https://support.google.com/analytics/answer/6004245?ref_topic=2919631).
- The before and after image size value.
- If Squoosh PWA, the type of Squoosh installation.
- If Squoosh PWA, the installation time and date.

# Developing

HEIC/HEIF still images can be opened using native browser decoding or a local
WASM fallback. The primary image is converted to 8-bit RGBA for editing;
HDR, auxiliary images and metadata are not preserved. The fallback accepts up
to 64 megapixels (up to 256 MiB for RGBA alone, plus decoder memory). Large
images may exceed a device's available memory. HEIC output is not supported.
The fallback converts decoded values to 8-bit RGBA without converting embedded
ICC profiles to sRGB; wide-gamut images (such as Display P3) can look different
from native browser decoding. Color-managed wide-gamut editing is not supported.

The fallback uses [libheif-js](https://github.com/catdad-experiments/libheif-js)
1.23.5 under LGPL-3.0, loaded as a separate module. Distributed notices are in
`src/copy/heic-decoder-licenses.txt`. Run `npm run test:heic` for decoder tests.
The decoder is cached in the background for offline use; the first load needs
connectivity until caching is complete.

To develop for Squoosh:

1. Clone the repository
1. To install node packages, run:
   ```sh
   npm install
   ```
1. Then build the app by running:
   ```sh
   npm run build
   ```
1. After building, start the development server by running:
   ```sh
   npm run dev
   ```

# Contributing

Squoosh is an open-source project that appreciates all community involvement. To contribute to the project, follow the [contribute guide](/CONTRIBUTING.md).

[squoosh]: https://squoosh.app
