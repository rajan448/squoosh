const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compile the real isolated TS modules without adding a runtime/test dependency.
function load(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
      },
    },
  ).outputText;
  new Function('require', 'exports', 'console', source)(
    (id) => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      throw new Error(`Unexpected import ${id} in ${file}`);
    },
    exports,
    { error() {} },
  );
  return exports;
}

const { sniffMimeType } = load('src/client/lazy-app/util/sniff-mime-type.ts');
const routingFile = 'src/client/lazy-app/util/decode-image.ts';
const decoderFile = 'src/features/decoders/heic/shared/decoder.ts';
const moduleName = 'libheif-js/libheif-wasm/libheif-bundle.mjs';

// Node has no ImageData; keep the browser's relevant buffer contract in tests.
global.ImageData = class ImageData {
  constructor(data, width, height) {
    assert.equal(data.length, width * height * 4);
    Object.assign(this, { data, width, height });
  }
};
global.self = { createImageBitmap() {} };

function ftyp(major, compatible = [], extended = false) {
  const header = extended ? 16 : 8;
  const result = Buffer.alloc(header + 8 + compatible.length * 4);
  result.writeUInt32BE(extended ? 1 : result.length);
  result.write('ftyp', 4);
  if (extended) result.writeUInt32BE(result.length, 12);
  result.write(major, header);
  compatible.forEach((brand, i) => result.write(brand, header + 8 + i * 4));
  return result;
}

test('recognizes HEIC major and compatible brands, generic HEIF and AVIF precedence', async () => {
  for (const brand of ['heic', 'heix', 'heim', 'heis']) {
    assert.equal(await sniffMimeType(new Blob([ftyp(brand)])), 'image/heic');
    assert.equal(
      await sniffMimeType(
        new Blob([ftyp('mif1', ['mif1', brand])], { type: 'image/jpeg' }),
      ),
      'image/heic',
    );
  }
  assert.equal(await sniffMimeType(new Blob([ftyp('mif1')])), 'image/heif');
  assert.equal(
    await sniffMimeType(new Blob([ftyp('mif1', ['heic', 'avif'])])),
    'image/avif',
  );
  assert.equal(await sniffMimeType(new Blob([ftyp('avif')])), 'image/avif');
  assert.equal(
    await sniffMimeType(new Blob([ftyp('mif1', ['heic'], true)])),
    'image/heic',
  );
  const padding = Buffer.from([0, 0, 0, 8, 102, 114, 101, 101]);
  assert.equal(
    await sniffMimeType(new Blob([padding, ftyp('heic')])),
    'image/heic',
  );
  const largePadding = Buffer.alloc(8192);
  largePadding.writeUInt32BE(largePadding.length);
  largePadding.write('free', 4);
  assert.equal(
    await sniffMimeType(new Blob([largePadding, ftyp('heic')])),
    'image/heic',
  );
});

test('rejects malformed, truncated and oversized ftyp boxes without trusting MIME', async () => {
  const oversized = ftyp('heic');
  oversized.writeUInt32BE(0xffffffff);
  const tooSmall = ftyp('heic');
  tooSmall.writeUInt32BE(4);
  const misaligned = Buffer.concat([ftyp('heic'), Buffer.from([0])]);
  misaligned.writeUInt32BE(misaligned.length);
  for (const data of [
    Buffer.alloc(0),
    ftyp('heic').subarray(0, 14),
    oversized,
    tooSmall,
    misaligned,
    Buffer.from('heic'),
  ]) {
    assert.equal(
      await sniffMimeType(new Blob([data], { type: 'image/heic' })),
      '',
    );
  }
});

test('preserves existing raster signatures', async () => {
  for (const [data, mime] of [
    ['\x89PNG\r\n\x1a\n', 'image/png'],
    ['\xff\xd8\xff', 'image/jpeg'],
    ['GIF89a', 'image/gif'],
    ['RIFF0000WEBPVP8 ', 'image/webp'],
    ['qoif', 'image/qoi'],
    ['\xff\x0a', 'image/jxl'],
    ['\xf4\xff\x6f', 'image/webp2'],
  ])
    assert.equal(
      await sniffMimeType(new Blob([Buffer.from(data, 'latin1')])),
      mime,
    );
});

function route(overrides = {}) {
  const calls = [];
  const pixels = { width: 1, height: 1 };
  const util = {
    assertSignal(signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    },
    async abortable(signal, promise) {
      util.assertSignal(signal);
      const value = await promise;
      util.assertSignal(signal);
      return value;
    },
    async sniffMimeType() {
      return 'image/heic';
    },
    async canDecodeImageType() {
      return false;
    },
    async builtinDecode() {
      calls.push('native');
      return pixels;
    },
    async blobToImg() {
      calls.push('element');
      throw Error('Unsupported');
    },
    ...overrides,
  };
  const decode = load(routingFile, {
    './index': util,
    './canvas': { drawableToImageData: () => pixels },
  }).default;
  const bridge = new Proxy(
    {},
    {
      get: (_, method) => async () => {
        calls.push(method);
        return pixels;
      },
    },
  );
  return { decode, calls, pixels, bridge };
}

test('uses worker when native HEIC support is absent and native when available', async () => {
  for (const canDecode of [false, true]) {
    const r = route({ canDecodeImageType: async () => canDecode });
    assert.equal(
      await r.decode(new AbortController().signal, new Blob(), r.bridge),
      r.pixels,
    );
    assert.deepEqual(r.calls, canDecode ? ['native'] : ['heicDecode']);
  }
});

test('actual native failure falls back despite a positive capability probe', async () => {
  const r = route({
    canDecodeImageType: async () => true,
    builtinDecode: async () => {
      throw Error('decode failed');
    },
  });
  await r.decode(new AbortController().signal, new Blob(), r.bridge);
  assert.deepEqual(r.calls, ['element', 'heicDecode']);
});

test('image element can succeed when bitmap decoding fails', async () => {
  const r = route({
    canDecodeImageType: async () => true,
    builtinDecode: async () => {
      throw Error('bitmap failed');
    },
    blobToImg: async () => ({}),
  });
  assert.equal(
    await r.decode(new AbortController().signal, new Blob(), r.bridge),
    r.pixels,
  );
  assert.deepEqual(r.calls, []);
});

test('abort during native decoding never enters fallback', async () => {
  const controller = new AbortController();
  const r = route({
    canDecodeImageType: async () => true,
    builtinDecode: async () => {
      controller.abort();
      throw Error('interrupted');
    },
  });
  await assert.rejects(r.decode(controller.signal, new Blob(), r.bridge), {
    name: 'AbortError',
  });
  assert.deepEqual(r.calls, []);
});

test('preserves HEIC diagnostics and existing decoder routing', async () => {
  const r = route();
  await assert.rejects(
    r.decode(new AbortController().signal, new Blob(), {
      heicDecode: async () => {
        throw Error('Invalid HEIC');
      },
    }),
    /Invalid HEIC/,
  );
  for (const [mime, method] of [
    ['avif', 'avifDecode'],
    ['webp', 'webpDecode'],
    ['jxl', 'jxlDecode'],
    ['webp2', 'wp2Decode'],
    ['qoi', 'qoiDecode'],
  ]) {
    const existing = route({ sniffMimeType: async () => `image/${mime}` });
    await existing.decode(
      new AbortController().signal,
      new Blob(),
      existing.bridge,
    );
    assert.deepEqual(existing.calls, [method]);
  }
});

function fakeModule(overrides = {}) {
  const freed = [];
  const context = {},
    handle = {},
    image = {};
  const module = {
    heif_error_code: { heif_error_Ok: 0 },
    heif_colorspace: { heif_colorspace_RGB: 1 },
    heif_chroma: { heif_chroma_interleaved_RGBA: 11 },
    heif_channel: { heif_channel_interleaved: 10 },
    heif_context_alloc: () => context,
    heif_context_read_from_memory: () => ({ code: 0 }),
    heif_js_context_get_primary_image_handle: () => handle,
    heif_image_handle_get_width: () => 1,
    heif_image_handle_get_height: () => 2,
    heif_js_decode_image2: async () => ({
      image,
      channels: [
        {
          id: 10,
          width: 1,
          height: 2,
          stride: 8,
          data: Uint8Array.from([1, 2, 3, 255, 0, 0, 0, 0, 4, 5, 6, 255]),
        },
      ],
    }),
    heif_image_release: (value) => {
      assert.equal(value, image);
      freed.push('image');
    },
    heif_image_handle_release: (value) => {
      assert.equal(value, handle);
      freed.push('handle');
    },
    heif_context_free: (value) => {
      assert.equal(value, context);
      freed.push('context');
    },
    ...overrides,
  };
  const decode = load(decoderFile, {
    [moduleName]: { default: () => module },
  }).default;
  return { decode, module, freed };
}

test('copies padded rows and releases primary image, handle and context', async () => {
  const m = fakeModule();
  const image = await m.decode(new Uint8Array());
  assert.deepEqual(Array.from(image.data), [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual(m.freed, ['image', 'handle', 'context']);
});

test('releases resources after parse, size and decode failures', async () => {
  for (const [overrides, expected] of [
    [{ heif_context_read_from_memory: () => ({ code: 2 }) }, ['context']],
    [{ heif_image_handle_get_width: () => 2 ** 30 }, ['handle', 'context']],
    [
      { heif_js_decode_image2: async () => ({ code: 4 }) },
      ['handle', 'context'],
    ],
  ]) {
    const m = fakeModule(overrides);
    await assert.rejects(m.decode(new Uint8Array()));
    assert.deepEqual(m.freed, expected);
  }
});

test('retries module initialization after failure', async () => {
  let attempts = 0;
  const m = fakeModule();
  const decode = load(decoderFile, {
    [moduleName]: {
      default: () => {
        if (++attempts === 1) throw Error('failed to initialize');
        return m.module;
      },
    },
  }).default;
  await assert.rejects(decode(new Uint8Array()), /initialize/);
  await decode(new Uint8Array());
  assert.equal(attempts, 2);
});

test('decodes real HEIC pixels repeatedly and recovers after corrupt input', async () => {
  const { default: factory } = await import(moduleName);
  const decode = load(decoderFile, {
    [moduleName]: { default: factory },
  }).default;
  const bytes = fs.readFileSync(
    path.join(__dirname, 'fixtures/quadrants.heic'),
  );
  assert.equal(await sniffMimeType(new Blob([bytes])), 'image/heic');
  await assert.rejects(decode(bytes.subarray(0, 40)), /Invalid/);
  for (let i = 0; i < 5; i++) {
    const image = await decode(bytes);
    assert.deepEqual([image.width, image.height], [32, 24]);
    const pixel = (x, y) =>
      Array.from(image.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    for (const [x, y, expected] of [
      [4, 4, [0, 0, 255]],
      [27, 4, [255, 255, 255]],
      [4, 19, [255, 0, 0]],
      [27, 19, [0, 255, 0]],
    ]) {
      const actual = pixel(x, y);
      expected.forEach((value, channel) =>
        assert.ok(
          Math.abs(value - actual[channel]) < 35,
          `${actual} vs ${expected}`,
        ),
      );
      assert.equal(actual[3], 255);
    }
  }
  if (process.env.HEIC_TEST_IMAGE) {
    const image = await decode(fs.readFileSync(process.env.HEIC_TEST_IMAGE));
    assert.ok(image.width > 0 && image.height > 0);
    console.log(`Camera fixture decoded: ${image.width} x ${image.height}`);
  }
});

test('selects the second image declared primary and applies container rotation', async () => {
  const { default: factory } = await import(moduleName);
  const decode = load(decoderFile, {
    [moduleName]: { default: factory },
  }).default;
  const image = await decode(
    fs.readFileSync(path.join(__dirname, 'fixtures/rotated-primary.heic')),
  );
  assert.deepEqual([image.width, image.height], [24, 32]);
  for (const [x, y, expected] of [
    [4, 4, [255, 255, 255]],
    [19, 4, [0, 255, 0]],
    [4, 27, [0, 0, 255]],
    [19, 27, [255, 0, 0]],
  ]) {
    const actual = image.data.subarray(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    );
    expected.forEach((value, channel) =>
      assert.ok(
        Math.abs(value - actual[channel]) < 35,
        `${actual} vs ${expected}`,
      ),
    );
  }
});

test('distinguishes unsupported codecs, allocation failure and decoder safety limits', async () => {
  for (const [error, message] of [
    [{ code: 4 }, /unsupported format or codec/],
    [{ code: 6 }, /Not enough memory/],
    [{ code: 2, subcode: 1000 }, /safety limits/],
  ]) {
    const m = fakeModule({ heif_context_read_from_memory: () => error });
    await assert.rejects(m.decode(new Uint8Array()), message);
    assert.deepEqual(m.freed, ['context']);
  }
});
