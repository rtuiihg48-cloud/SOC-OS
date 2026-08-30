import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AudioFormatError,
  detectAudioFormat,
  ensureCompatibleFormat,
  isSupportedAudioMimeType,
  type AudioFormat,
} from "@workspace/integrations-openai-ai-server/audio";

const execFileAsync = promisify(execFile);

type AudioFixture = {
  name: string;
  extension: string;
  detectedFormat: AudioFormat;
  codecArgs: string[];
  compatibleFormat: "wav" | "mp3";
};

const FIXTURES: AudioFixture[] = [
  { name: "wav", extension: "wav", detectedFormat: "wav", codecArgs: ["-c:a", "pcm_s16le"], compatibleFormat: "wav" },
  { name: "mp3", extension: "mp3", detectedFormat: "mp3", codecArgs: ["-c:a", "libmp3lame"], compatibleFormat: "mp3" },
  { name: "webm", extension: "webm", detectedFormat: "webm", codecArgs: ["-c:a", "libopus"], compatibleFormat: "wav" },
  { name: "mp4", extension: "m4a", detectedFormat: "mp4", codecArgs: ["-c:a", "aac"], compatibleFormat: "wav" },
  { name: "ogg", extension: "ogg", detectedFormat: "ogg", codecArgs: ["-c:a", "libopus"], compatibleFormat: "wav" },
  { name: "aac", extension: "aac", detectedFormat: "aac", codecArgs: ["-c:a", "aac", "-f", "adts"], compatibleFormat: "wav" },
  { name: "flac", extension: "flac", detectedFormat: "flac", codecArgs: ["-c:a", "flac"], compatibleFormat: "wav" },
];

describe("voice audio format handling", () => {
  let fixtureDir: string;
  const buffers = new Map<string, Buffer>();

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "soc-voice-audio-"));
    for (const fixture of FIXTURES) {
      const outputPath = join(fixtureDir, `${fixture.name}.${fixture.extension}`);
      await execFileAsync("ffmpeg", [
        "-v", "error",
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=0.2",
        ...fixture.codecArgs,
        "-y",
        outputPath,
      ]);
      buffers.set(fixture.name, await readFile(outputPath));
    }
    const unsupportedPath = join(fixtureDir, "unsupported.aiff");
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=0.2",
      "-c:a", "pcm_s16be",
      "-y",
      unsupportedPath,
    ]);
    buffers.set("unsupported", await readFile(unsupportedPath));
    const matroskaPath = join(fixtureDir, "unsupported.mkv");
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=0.2",
      "-c:a", "libopus",
      "-f", "matroska",
      "-y",
      matroskaPath,
    ]);
    buffers.set("matroska", await readFile(matroskaPath));
  }, 30_000);

  afterAll(async () => {
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  });

  it.each(FIXTURES)("detects and accepts a valid $name recording", async (fixture) => {
    const buffer = buffers.get(fixture.name);
    expect(buffer).toBeDefined();
    expect(detectAudioFormat(buffer!)).toBe(fixture.detectedFormat);

    const compatible = await ensureCompatibleFormat(buffer!);
    expect(compatible.format).toBe(fixture.compatibleFormat);
    expect(compatible.buffer.length).toBeGreaterThan(44);
    expect(detectAudioFormat(compatible.buffer)).toBe(fixture.compatibleFormat);
  }, 15_000);

  it.each([
    "audio/webm;codecs=opus",
    "audio/ogg; codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/x-m4a",
    "audio/aac",
    "audio/flac",
    "application/ogg",
    "application/octet-stream",
    "video/webm;codecs=opus",
    "video/mp4",
  ])("accepts the browser or upload MIME hint %s", (contentType) => {
    expect(isSupportedAudioMimeType(contentType)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "text/plain",
    "application/json",
    "video/quicktime",
  ])("rejects unsupported MIME hint %s", (contentType) => {
    expect(isSupportedAudioMimeType(contentType)).toBe(false);
  });

  it("rejects empty, corrupt, and truncated audio", async () => {
    await expect(ensureCompatibleFormat(Buffer.alloc(0))).rejects.toBeInstanceOf(AudioFormatError);
    await expect(ensureCompatibleFormat(Buffer.from("not audio"))).rejects.toBeInstanceOf(AudioFormatError);
  });

  it("does not let a MIME hint authorize an unlisted decodable container", async () => {
    const unsupported = buffers.get("unsupported")!;
    expect(detectAudioFormat(unsupported)).toBe("unknown");
    expect(isSupportedAudioMimeType("application/octet-stream")).toBe(true);
    await expect(ensureCompatibleFormat(unsupported)).rejects.toBeInstanceOf(AudioFormatError);
  });

  it("rejects Matroska EBML even when the MIME hint advertises WebM", async () => {
    const matroska = buffers.get("matroska")!;
    expect(matroska.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    expect(isSupportedAudioMimeType("video/webm;codecs=opus")).toBe(true);
    expect(detectAudioFormat(matroska)).toBe("unknown");
    await expect(ensureCompatibleFormat(matroska)).rejects.toBeInstanceOf(AudioFormatError);
  });

  it.each(FIXTURES)("rejects a trailing-truncated $name recording", async (fixture) => {
    const buffer = buffers.get(fixture.name)!;
    await expect(ensureCompatibleFormat(buffer.subarray(0, -20))).rejects.toBeInstanceOf(AudioFormatError);
  });

  it("does not mistake a generic RIFF file for WAV", () => {
    const invalidRiff = Buffer.alloc(12);
    invalidRiff.write("RIFF", 0, "ascii");
    invalidRiff.write("AVI ", 8, "ascii");
    expect(detectAudioFormat(invalidRiff)).toBe("unknown");
  });
});