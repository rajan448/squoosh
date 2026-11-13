/** Read box headers separately so padding never forces a large allocation. */
async function sniffContainerType(
  blob: Blob,
): Promise<'image/avif' | 'image/heic' | 'image/heif' | ''> {
  let offset = 0;
  // Limit work for files containing pathological numbers of padding boxes.
  for (let box = 0; box < 32 && offset + 8 <= blob.size; box++) {
    const header = new Uint8Array(
      await new Response(blob.slice(offset, offset + 16)).arrayBuffer(),
    );
    const view = new DataView(header.buffer);
    const text = (bytes: Uint8Array, at: number) =>
      String.fromCharCode(...bytes.subarray(at, at + 4));
    let size = view.getUint32(0);
    const type = text(header, 4);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16 || view.getUint32(8) !== 0) return '';
      size = view.getUint32(12);
      headerSize = 16;
    } else if (size === 0) {
      size = blob.size - offset;
    }
    if (size < headerSize || size > blob.size - offset) return '';
    if (type === 'ftyp') {
      if (size < headerSize + 8 || size > 4096 || (size - headerSize) % 4 !== 0)
        return '';
      const bytes = new Uint8Array(
        await new Response(blob.slice(offset, offset + size)).arrayBuffer(),
      );
      const brands = [text(bytes, headerSize)];
      for (let i = headerSize + 8; i < size; i += 4)
        brands.push(text(bytes, i));
      if (brands.some((brand) => brand === 'avif' || brand === 'avis'))
        return 'image/avif';
      if (
        brands.some((brand) => ['heic', 'heix', 'heim', 'heis'].includes(brand))
      )
        return 'image/heic';
      if (brands.some((brand) => brand === 'mif1' || brand === 'msf1'))
        return 'image/heif';
      return '';
    }
    if (type !== 'free' && type !== 'skip') return '';
    offset += size;
  }
  return '';
}

const magicNumberMapInput = [
  [/^%PDF-/, 'application/pdf'],
  [/^GIF87a/, 'image/gif'],
  [/^GIF89a/, 'image/gif'],
  [/^\x89PNG\x0D\x0A\x1A\x0A/, 'image/png'],
  [/^\xFF\xD8\xFF/, 'image/jpeg'],
  [/^BM/, 'image/bmp'],
  [/^I I/, 'image/tiff'],
  [/^II*/, 'image/tiff'],
  [/^MM\x00*/, 'image/tiff'],
  [/^RIFF....WEBPVP8[LX ]/s, 'image/webp'],
  [/^\xF4\xFF\x6F/, 'image/webp2'],
  [/^\xff\x0a/, 'image/jxl'],
  [/^\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a/, 'image/jxl'],
  [/^qoif/, 'image/qoi'],
] as const;

export type ImageMimeTypes =
  | typeof magicNumberMapInput[number][1]
  | 'image/avif'
  | 'image/heic'
  | 'image/heif';

const magicNumberToMimeType = new Map<RegExp, ImageMimeTypes>(
  magicNumberMapInput,
);

export async function sniffMimeType(blob: Blob): Promise<ImageMimeTypes | ''> {
  const firstChunk = await new Response(blob.slice(0, 16)).arrayBuffer();
  const containerType = await sniffContainerType(blob);
  if (containerType) return containerType;
  const firstChunkString = Array.from(new Uint8Array(firstChunk))
    .map((v) => String.fromCodePoint(v))
    .join('');
  for (const [detector, mimeType] of magicNumberToMimeType) {
    if (detector.test(firstChunkString)) {
      return mimeType;
    }
  }
  return '';
}
