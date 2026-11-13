import createModule from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import type {
  MainModule,
  heif_image_handle,
  heif_image,
} from 'libheif-js/libheif-wasm/libheif';

let modulePromise: Promise<MainModule> | undefined;

async function getModule(): Promise<MainModule> {
  if (!modulePromise) {
    modulePromise = Promise.resolve().then(() => createModule());
    modulePromise = modulePromise.catch((err) => {
      modulePromise = undefined;
      console.error(err);
      throw new Error(
        'Could not initialize the HEIC decoder. Please try again.',
      );
    });
  }
  return modulePromise;
}

// At most 256 MiB for the output buffer, in addition to the codec's memory.
export const maxPixels = 64 * 1024 * 1024;

interface DecodedPlane {
  id: MainModule['heif_channel']['heif_channel_interleaved'];
  width: number;
  height: number;
  stride: number;
  data: Uint8Array;
}

interface DecoderFailure {
  code?: number | { value: number };
  subcode?: number | { value: number };
  message?: unknown;
}

function decoderError(error: DecoderFailure, fallback: string): Error {
  const code = typeof error.code === 'object' ? error.code.value : error.code;
  const subcode =
    typeof error.subcode === 'object' ? error.subcode.value : error.subcode;
  console.error('HEIC decoder error', {
    code,
    subcode,
    message: String(error.message || ''),
  });
  if (code === 3 || code === 4)
    return new Error(
      'This HEIC/HEIF file uses an unsupported format or codec.',
    );
  if (code === 6)
    return new Error('Not enough memory to decode this HEIC/HEIF image.');
  if (subcode === 1000)
    return new Error('HEIC/HEIF image exceeds the decoder safety limits.');
  return new Error(fallback);
}

export default async function decode(data: Uint8Array): Promise<ImageData> {
  const module = await getModule();
  const context = module.heif_context_alloc();
  if (!context) throw new Error('Could not allocate the HEIC decoder.');
  let handle: heif_image_handle | undefined;
  let image: heif_image | undefined;
  try {
    const error = module.heif_context_read_from_memory(context, data);
    if (error.code !== module.heif_error_code.heif_error_Ok) {
      throw decoderError(error, 'Invalid or unsupported HEIC/HEIF image.');
    }
    const primary = module.heif_js_context_get_primary_image_handle(context);
    if (!primary || primary.code) {
      throw decoderError(
        primary || {},
        'The HEIC/HEIF file has no valid primary image.',
      );
    }
    handle = primary;
    const width = module.heif_image_handle_get_width(primary);
    const height = module.heif_image_handle_get_height(primary);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > maxPixels / height
    ) {
      throw new Error('HEIC image exceeds the 64 megapixel decoding limit.');
    }
    // libheif applies container crop, mirror and rotation transformations.
    const decoded = await module.heif_js_decode_image2(
      primary,
      module.heif_colorspace.heif_colorspace_RGB,
      module.heif_chroma.heif_chroma_interleaved_RGBA,
    );
    if (!decoded || decoded.code) {
      throw decoderError(
        decoded || {},
        'Could not decode HEIC/HEIF image. The file may be damaged or use an unsupported codec.',
      );
    }
    image = decoded.image;
    const plane = (decoded.channels as DecodedPlane[]).find(
      (channel) => channel.id === module.heif_channel.heif_channel_interleaved,
    );
    if (
      !plane ||
      plane.width <= 0 ||
      plane.height <= 0 ||
      !Number.isSafeInteger(plane.width) ||
      !Number.isSafeInteger(plane.height) ||
      plane.width > maxPixels / plane.height ||
      plane.stride < plane.width * 4 ||
      plane.data.length < (plane.height - 1) * plane.stride + plane.width * 4
    ) {
      throw new Error('HEIC decoder returned invalid image data.');
    }
    const pixels = new Uint8ClampedArray(plane.width * plane.height * 4);
    for (let row = 0; row < plane.height; row++) {
      pixels.set(
        plane.data.subarray(
          row * plane.stride,
          row * plane.stride + plane.width * 4,
        ),
        row * plane.width * 4,
      );
    }
    return new ImageData(pixels, plane.width, plane.height);
  } finally {
    if (image) module.heif_image_release(image);
    if (handle) module.heif_image_handle_release(handle);
    module.heif_context_free(context);
  }
}
