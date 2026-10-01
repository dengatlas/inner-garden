import { deflateRawSync, inflateRawSync } from 'node:zlib';
const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
export function createZip(entries) {
  const chunks = [], directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (!name || name.includes('..') || name.startsWith('/') || /[:\\]/.test(name)) throw new Error(`Unsafe ZIP path: ${name}`);
    const filename = Buffer.from(name, 'utf8'), compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data), header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(header, filename, compressed); directory.push(central, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
export function readZip(buffer) {
  const entries = [];
  let position = 0;
  while (position + 30 <= buffer.length && buffer.readUInt32LE(position) === 0x04034b50) {
    const method = buffer.readUInt16LE(position + 8), crc = buffer.readUInt32LE(position + 14);
    const size = buffer.readUInt32LE(position + 18), rawSize = buffer.readUInt32LE(position + 22);
    const nameSize = buffer.readUInt16LE(position + 26), extraSize = buffer.readUInt16LE(position + 28);
    const name = buffer.subarray(position + 30, position + 30 + nameSize).toString('utf8');
    const start = position + 30 + nameSize + extraSize;
    if (method !== 8) throw new Error('Unsupported ZIP method');
    const data = inflateRawSync(buffer.subarray(start, start + size));
    if (data.length !== rawSize || crc32(data) !== crc) throw new Error(`Corrupt ZIP entry: ${name}`);
    entries.push({ name, data }); position = start + size;
  }
  return entries;
}
