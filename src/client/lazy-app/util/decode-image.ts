import type WorkerBridge from '../worker-bridge';
import {
  assertSignal,
  abortable,
  builtinDecode,
  blobToImg,
  canDecodeImageType,
  sniffMimeType,
} from './index';
import { drawableToImageData } from './canvas';

export default async function decodeImage(
  signal: AbortSignal,
  blob: Blob,
  workerBridge: WorkerBridge,
): Promise<ImageData> {
  assertSignal(signal);
  const mimeType = await abortable(signal, sniffMimeType(blob));
  const heif = mimeType === 'image/heic' || mimeType === 'image/heif';
  const canDecode = await abortable(signal, canDecodeImageType(mimeType));

  try {
    if (heif) {
      if (canDecode) {
        try {
          return await builtinDecode(signal, blob);
        } catch (err) {
          assertSignal(signal);
          if (err instanceof Error && err.name === 'AbortError') throw err;
        }
        // Some browsers support HEIC in image elements but not ImageBitmap.
        if ('createImageBitmap' in self) {
          try {
            const image = await abortable(signal, blobToImg(blob));
            assertSignal(signal);
            return drawableToImageData(image);
          } catch (err) {
            assertSignal(signal);
            if (err instanceof Error && err.name === 'AbortError') throw err;
          }
        }
      }
      return await workerBridge.heicDecode(signal, blob);
    }
    if (!canDecode) {
      if (mimeType === 'image/avif')
        return await workerBridge.avifDecode(signal, blob);
      if (mimeType === 'image/webp')
        return await workerBridge.webpDecode(signal, blob);
      if (mimeType === 'image/jxl')
        return await workerBridge.jxlDecode(signal, blob);
      if (mimeType === 'image/webp2')
        return await workerBridge.wp2Decode(signal, blob);
      if (mimeType === 'image/qoi')
        return await workerBridge.qoiDecode(signal, blob);
    }
    return await builtinDecode(signal, blob);
  } catch (err) {
    assertSignal(signal);
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.error(err);
    if (heif && err instanceof Error) throw err;
    throw Error("Couldn't decode image");
  }
}
