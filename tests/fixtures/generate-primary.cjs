// Add a second, rotated HEVC item sharing the generated quadrants' coded bytes.
// Declaring that item primary makes choosing the first image observably wrong.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'quadrants.heic'));
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const box = (type, payload) =>
  Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]);
function split(buffer, start = 0) {
  const boxes = [];
  for (let at = start; at < buffer.length; ) {
    let size = buffer.readUInt32BE(at);
    if (size === 1) size = Number(buffer.readBigUInt64BE(at + 8));
    boxes.push({
      type: buffer.toString('ascii', at + 4, at + 8),
      data: buffer.subarray(at, at + size),
    });
    at += size;
  }
  return boxes;
}
const top = split(source);
const meta = top.find((b) => b.type === 'meta').data;
const originalIloc = split(meta.subarray(12)).find(
  (b) => b.type === 'iloc',
).data;
function makeMeta(delta) {
  return box(
    'meta',
    Buffer.concat([
      Buffer.alloc(4),
      ...split(meta.subarray(12)).map(({ type, data }) => {
        if (type === 'pitm')
          return box(type, Buffer.concat([Buffer.alloc(4), u16(3)]));
        if (type === 'iinf') {
          const entries = split(data.subarray(14));
          const clone = Buffer.from(entries[0].data);
          clone.writeUInt16BE(3, 12);
          return box(
            type,
            Buffer.concat([
              Buffer.alloc(4),
              u16(3),
              ...entries.map((e) => e.data),
              clone,
            ]),
          );
        }
        if (type === 'iprp')
          return box(
            type,
            Buffer.concat(
              split(data.subarray(8)).map(({ type, data }) => {
                if (type === 'ipco')
                  return box(
                    type,
                    Buffer.concat([
                      data.subarray(8),
                      box('irot', Buffer.from([1])),
                    ]),
                  );
                if (type === 'ipma')
                  return box(
                    type,
                    Buffer.concat([
                      Buffer.alloc(4),
                      u32(2),
                      data.subarray(16),
                      u16(3),
                      Buffer.from([6, 0x81, 2, 3, 5, 0x86, 0x87]),
                    ]),
                  );
                return data;
              }),
            ),
          );
        if (type === 'iloc') {
          const result = Buffer.from(originalIloc);
          result.writeUInt32BE(result.readUInt32BE(22) + delta, 22);
          result.writeUInt32BE(result.readUInt32BE(36) + delta, 36);
          const clone = Buffer.from(result.subarray(16, 30));
          clone.writeUInt16BE(3);
          result.writeUInt16BE(3, 14);
          return box(type, Buffer.concat([result.subarray(8), clone]));
        }
        return data;
      }),
    ]),
  );
}
const delta = makeMeta(0).length - meta.length;
const result = Buffer.concat(
  top.map((b) => (b.type === 'meta' ? makeMeta(delta) : b.data)),
);
fs.writeFileSync(path.join(__dirname, 'rotated-primary.heic'), result);
