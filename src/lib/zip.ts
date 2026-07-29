import { inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; text: string };

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * Reads the entries of a ZIP archive held in memory.
 *
 * The economic-data mirror answers a multi-series request with a plain CSV
 * when every series shares one frequency and with a small ZIP of one CSV per
 * frequency when they do not. Handling the archive here is what makes it
 * possible to request twelve series at a time instead of one, which is the
 * difference between roughly fifty outbound requests per refresh and five.
 *
 * Only the two compression methods the mirror actually emits are supported,
 * and the central directory is used rather than the local headers because the
 * local headers of a streamed archive can carry zero-length sizes.
 */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  let directoryEnd = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === END_OF_DIRECTORY_SIGNATURE) {
      directoryEnd = index;
      break;
    }
  }
  if (directoryEnd < 0) throw new Error("The archive has no central directory.");

  const entryCount = buffer.readUInt16LE(directoryEnd + 10);
  let cursor = buffer.readUInt32LE(directoryEnd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("The archive directory is malformed.");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`The archive uses unsupported compression method ${method}.`);
    }
    entries.push({
      name,
      text: (method === STORED ? raw : inflateRawSync(raw)).toString("utf8"),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function isZip(buffer: Buffer) {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}
