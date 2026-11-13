import { blobToArrayBuffer } from 'features/worker-utils';

export default async function heicDecode(blob: Blob): Promise<ImageData> {
  let decoder: typeof import('../shared/decoder');
  try {
    decoder = await import('../shared/decoder');
  } catch (err) {
    console.error(err);
    throw new Error(
      'Could not load the HEIC decoder. Connect to the internet and try again.',
    );
  }
  return decoder.default(new Uint8Array(await blobToArrayBuffer(blob)));
}
