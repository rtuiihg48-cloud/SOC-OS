import { Buffer } from "node:buffer";

export type ContainerAudioFormat = "wav" | "mp3" | "webm" | "mp4" | "ogg" | "aac" | "flac";

export type AudioContainerValidation = {
  durationSeconds?: number;
};

export class AudioFormatError extends Error {
  constructor(message = "The audio file is damaged or its container cannot be decoded.") {
    super(message);
    this.name = "AudioFormatError";
  }
}

function invalidAudio(): never {
  throw new AudioFormatError();
}

function validateWav(buffer: Buffer): AudioContainerValidation {
  if (
    buffer.length < 44 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return invalidAudio();
  }

  const riffEnd = buffer.readUInt32LE(4) + 8;
  if (riffEnd !== buffer.length) return invalidAudio();

  let cursor = 12;
  let byteRate = 0;
  let dataBytes = 0;
  let hasFormat = false;
  let hasData = false;
  while (cursor < riffEnd) {
    if (cursor + 8 > riffEnd) return invalidAudio();
    const chunkId = buffer.subarray(cursor, cursor + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (dataEnd > riffEnd || paddedEnd > riffEnd) return invalidAudio();

    if (chunkId === "fmt ") {
      if (chunkSize < 16) return invalidAudio();
      byteRate = buffer.readUInt32LE(dataStart + 8);
      hasFormat = byteRate > 0;
    } else if (chunkId === "data") {
      dataBytes += chunkSize;
      hasData = true;
    }
    cursor = paddedEnd;
  }

  if (cursor !== riffEnd || !hasFormat || !hasData || dataBytes === 0) return invalidAudio();
  return { durationSeconds: dataBytes / byteRate };
}

function validateMp4(buffer: Buffer): AudioContainerValidation {
  let cursor = 0;
  let hasFileType = false;
  let hasMediaData = false;
  let hasMovieMetadata = false;

  while (cursor < buffer.length) {
    if (cursor + 8 > buffer.length) return invalidAudio();
    let boxSize = buffer.readUInt32BE(cursor);
    const boxType = buffer.subarray(cursor + 4, cursor + 8).toString("ascii");
    let headerSize = 8;
    if (boxSize === 1) {
      if (cursor + 16 > buffer.length) return invalidAudio();
      const extendedSize = buffer.readBigUInt64BE(cursor + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return invalidAudio();
      boxSize = Number(extendedSize);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = buffer.length - cursor;
    }

    if (boxSize < headerSize || cursor + boxSize > buffer.length) return invalidAudio();
    hasFileType ||= boxType === "ftyp";
    hasMediaData ||= boxType === "mdat";
    hasMovieMetadata ||= boxType === "moov" || boxType === "moof";
    cursor += boxSize;
  }

  if (cursor !== buffer.length || !hasFileType || !hasMediaData || !hasMovieMetadata) return invalidAudio();
  return {};
}

function validateOgg(buffer: Buffer): AudioContainerValidation {
  let cursor = 0;
  let pageCount = 0;
  let finalHeaderType = 0;
  while (cursor < buffer.length) {
    if (
      cursor + 27 > buffer.length ||
      buffer.subarray(cursor, cursor + 4).toString("ascii") !== "OggS" ||
      buffer[cursor + 4] !== 0
    ) {
      return invalidAudio();
    }

    const headerType = buffer[cursor + 5];
    const segmentCount = buffer[cursor + 26];
    const segmentTableEnd = cursor + 27 + segmentCount;
    if (segmentTableEnd > buffer.length) return invalidAudio();

    let bodySize = 0;
    for (let index = cursor + 27; index < segmentTableEnd; index += 1) {
      bodySize += buffer[index];
    }
    const pageEnd = segmentTableEnd + bodySize;
    if (pageEnd > buffer.length) return invalidAudio();
    cursor = pageEnd;
    finalHeaderType = headerType;
    pageCount += 1;
  }

  if (cursor !== buffer.length || pageCount === 0 || (finalHeaderType & 0x04) === 0) return invalidAudio();
  return {};
}

const MPEG1_BITRATES = {
  3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
} as const;
const MPEG2_BITRATES = {
  3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;

function syncSafeInteger(buffer: Buffer, offset: number): number {
  if ([0, 1, 2, 3].some((index) => (buffer[offset + index] & 0x80) !== 0)) return invalidAudio();
  return (
    (buffer[offset] << 21) |
    (buffer[offset + 1] << 14) |
    (buffer[offset + 2] << 7) |
    buffer[offset + 3]
  );
}

function validateMp3(buffer: Buffer): AudioContainerValidation {
  let cursor = 0;
  let frameCount = 0;
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") {
    if (buffer.length < 10) return invalidAudio();
    const footerSize = (buffer[5] & 0x10) !== 0 ? 10 : 0;
    cursor = 10 + syncSafeInteger(buffer, 6) + footerSize;
    if (cursor > buffer.length) return invalidAudio();
  }

  while (cursor < buffer.length) {
    if (
      buffer.length - cursor === 128 &&
      buffer.subarray(cursor, cursor + 3).toString("ascii") === "TAG"
    ) {
      cursor = buffer.length;
      break;
    }
    if (cursor + 4 > buffer.length) return invalidAudio();

    const header = buffer.readUInt32BE(cursor);
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return invalidAudio();
    const versionBits = (header >>> 19) & 0x03;
    const layerBits = (header >>> 17) & 0x03;
    const bitrateIndex = (header >>> 12) & 0x0f;
    const sampleRateIndex = (header >>> 10) & 0x03;
    const padding = (header >>> 9) & 0x01;
    if (
      versionBits === 1 ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleRateIndex === 3
    ) {
      return invalidAudio();
    }

    const isMpeg1 = versionBits === 3;
    const bitrateTable = isMpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES;
    const bitrate = bitrateTable[layerBits as 1 | 2 | 3][bitrateIndex] * 1000;
    const baseSampleRates = versionBits === 3
      ? [44_100, 48_000, 32_000]
      : versionBits === 2
        ? [22_050, 24_000, 16_000]
        : [11_025, 12_000, 8_000];
    const sampleRate = baseSampleRates[sampleRateIndex];
    const frameLength = layerBits === 3
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor(((layerBits === 1 && !isMpeg1 ? 72 : 144) * bitrate) / sampleRate + padding);
    if (frameLength < 4 || cursor + frameLength > buffer.length) return invalidAudio();
    cursor += frameLength;
    frameCount += 1;
  }

  if (cursor !== buffer.length || frameCount === 0) return invalidAudio();
  return {};
}

const AAC_SAMPLE_RATES = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
  22_050, 16_000, 12_000, 11_025, 8_000, 7_350,
] as const;

function validateAac(buffer: Buffer): AudioContainerValidation {
  let cursor = 0;
  let frameCount = 0;
  let durationSeconds = 0;
  while (cursor < buffer.length) {
    if (
      cursor + 7 > buffer.length ||
      buffer[cursor] !== 0xff ||
      (buffer[cursor + 1] & 0xf6) !== 0xf0
    ) {
      return invalidAudio();
    }
    const sampleRateIndex = (buffer[cursor + 2] >>> 2) & 0x0f;
    const sampleRate = AAC_SAMPLE_RATES[sampleRateIndex];
    if (!sampleRate) return invalidAudio();
    const headerSize = (buffer[cursor + 1] & 0x01) === 1 ? 7 : 9;
    const frameLength = (
      ((buffer[cursor + 3] & 0x03) << 11) |
      (buffer[cursor + 4] << 3) |
      ((buffer[cursor + 5] & 0xe0) >>> 5)
    );
    if (frameLength < headerSize || cursor + frameLength > buffer.length) return invalidAudio();
    const rawDataBlocks = buffer[cursor + 6] & 0x03;
    durationSeconds += (1024 * (rawDataBlocks + 1)) / sampleRate;
    cursor += frameLength;
    frameCount += 1;
  }

  if (cursor !== buffer.length || frameCount === 0) return invalidAudio();
  return { durationSeconds };
}

function validateFlac(buffer: Buffer): AudioContainerValidation {
  if (buffer.length < 42 || buffer.subarray(0, 4).toString("ascii") !== "fLaC") return invalidAudio();

  let cursor = 4;
  let metadataCount = 0;
  let sawLastMetadata = false;
  let sampleRate = 0;
  let totalSamples = 0;
  while (!sawLastMetadata) {
    if (cursor + 4 > buffer.length) return invalidAudio();
    const metadataHeader = buffer[cursor];
    const blockType = metadataHeader & 0x7f;
    const blockLength = buffer.readUIntBE(cursor + 1, 3);
    const dataStart = cursor + 4;
    const dataEnd = dataStart + blockLength;
    if (dataEnd > buffer.length) return invalidAudio();
    if (metadataCount === 0) {
      if (blockType !== 0 || blockLength !== 34) return invalidAudio();
      const packed = buffer.readBigUInt64BE(dataStart + 10);
      sampleRate = Number((packed >> 44n) & 0xfffffn);
      totalSamples = Number(packed & ((1n << 36n) - 1n));
      if (sampleRate === 0) return invalidAudio();
    }
    sawLastMetadata = (metadataHeader & 0x80) !== 0;
    cursor = dataEnd;
    metadataCount += 1;
  }

  if (metadataCount === 0 || cursor >= buffer.length) return invalidAudio();
  return totalSamples > 0 ? { durationSeconds: totalSamples / sampleRate } : {};
}

type EbmlElement = {
  id: bigint;
  dataStart: number;
  dataEnd: number | null;
};

function vintLength(firstByte: number, maximum: number): number {
  for (let length = 1; length <= maximum; length += 1) {
    if ((firstByte & (0x80 >>> (length - 1))) !== 0) return length;
  }
  return invalidAudio();
}

function readEbmlElement(buffer: Buffer, offset: number, limit: number): EbmlElement {
  if (offset >= limit) return invalidAudio();
  const idLength = vintLength(buffer[offset], 4);
  if (offset + idLength >= limit) return invalidAudio();
  let id = 0n;
  for (let index = 0; index < idLength; index += 1) {
    id = (id << 8n) | BigInt(buffer[offset + index]);
  }

  const sizeOffset = offset + idLength;
  const sizeLength = vintLength(buffer[sizeOffset], 8);
  if (sizeOffset + sizeLength > limit) return invalidAudio();
  const marker = 0x80 >>> (sizeLength - 1);
  let size = BigInt(buffer[sizeOffset] & (marker - 1));
  for (let index = 1; index < sizeLength; index += 1) {
    size = (size << 8n) | BigInt(buffer[sizeOffset + index]);
  }
  const unknownSize = size === (1n << BigInt(sizeLength * 7)) - 1n;
  const dataStart = sizeOffset + sizeLength;
  if (unknownSize) return { id, dataStart, dataEnd: null };
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) return invalidAudio();
  const dataEnd = dataStart + Number(size);
  if (dataEnd > limit) return invalidAudio();
  return { id, dataStart, dataEnd };
}

const EBML_HEADER_ID = 0x1a45dfa3n;
const EBML_SEGMENT_ID = 0x18538067n;
const EBML_CLUSTER_ID = 0x1f43b675n;
const EBML_TRACKS_ID = 0x1654ae6bn;
const EBML_DOC_TYPE_ID = 0x4282n;
const SEGMENT_LEVEL_IDS = new Set([
  0x114d9b74n,
  0x1549a966n,
  EBML_TRACKS_ID,
  0x1941a469n,
  EBML_CLUSTER_ID,
  0x1c53bb6bn,
  0x1254c367n,
]);

function consumeUnknownCluster(buffer: Buffer, start: number, segmentEnd: number): number {
  let cursor = start;
  let childCount = 0;
  while (cursor < segmentEnd) {
    const child = readEbmlElement(buffer, cursor, segmentEnd);
    if (childCount > 0 && SEGMENT_LEVEL_IDS.has(child.id)) break;
    if (child.dataEnd === null) return invalidAudio();
    cursor = child.dataEnd;
    childCount += 1;
  }
  if (childCount === 0) return invalidAudio();
  return cursor;
}

export function hasWebmDocType(buffer: Buffer): boolean {
  try {
    const header = readEbmlElement(buffer, 0, buffer.length);
    if (header.id !== EBML_HEADER_ID || header.dataEnd === null) return false;
    let cursor = header.dataStart;
    let docType: string | null = null;
    while (cursor < header.dataEnd) {
      const child = readEbmlElement(buffer, cursor, header.dataEnd);
      if (child.dataEnd === null) return false;
      if (child.id === EBML_DOC_TYPE_ID) {
        docType = buffer.subarray(child.dataStart, child.dataEnd).toString("ascii").toLowerCase();
      }
      cursor = child.dataEnd;
    }
    return cursor === header.dataEnd && docType === "webm";
  } catch {
    return false;
  }
}

function validateWebm(buffer: Buffer): AudioContainerValidation {
  if (!hasWebmDocType(buffer)) return invalidAudio();
  const header = readEbmlElement(buffer, 0, buffer.length);
  if (header.id !== EBML_HEADER_ID || header.dataEnd === null) return invalidAudio();
  const segment = readEbmlElement(buffer, header.dataEnd, buffer.length);
  if (segment.id !== EBML_SEGMENT_ID) return invalidAudio();
  const segmentEnd = segment.dataEnd ?? buffer.length;
  if (segmentEnd !== buffer.length) return invalidAudio();

  let cursor = segment.dataStart;
  let clusterCount = 0;
  let hasTracks = false;
  while (cursor < segmentEnd) {
    const element = readEbmlElement(buffer, cursor, segmentEnd);
    hasTracks ||= element.id === EBML_TRACKS_ID;
    if (element.id === EBML_CLUSTER_ID) {
      clusterCount += 1;
      cursor = element.dataEnd ?? consumeUnknownCluster(buffer, element.dataStart, segmentEnd);
    } else {
      if (element.dataEnd === null) return invalidAudio();
      cursor = element.dataEnd;
    }
  }

  if (cursor !== segmentEnd || clusterCount === 0 || !hasTracks) return invalidAudio();
  return {};
}

export function assertCompleteAudioContainer(
  buffer: Buffer,
  format: ContainerAudioFormat,
): AudioContainerValidation {
  if (buffer.length === 0) return invalidAudio();
  switch (format) {
    case "wav": return validateWav(buffer);
    case "mp3": return validateMp3(buffer);
    case "webm": return validateWebm(buffer);
    case "mp4": return validateMp4(buffer);
    case "ogg": return validateOgg(buffer);
    case "aac": return validateAac(buffer);
    case "flac": return validateFlac(buffer);
  }
}

export function wavDurationSeconds(buffer: Buffer): number {
  const duration = validateWav(buffer).durationSeconds;
  if (!duration) return invalidAudio();
  return duration;
}