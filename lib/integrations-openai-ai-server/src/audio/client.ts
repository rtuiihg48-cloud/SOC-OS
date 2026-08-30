import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";
import { spawn } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertCompleteAudioContainer,
  AudioFormatError,
  hasWebmDocType,
  type ContainerAudioFormat,
  wavDurationSeconds,
} from "./validation";

export { AudioFormatError } from "./validation";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type AudioFormat = ContainerAudioFormat | "unknown";

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/aacp",
  "audio/flac",
  "audio/mp3",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav",
  "application/mp4",
  "application/ogg",
  "application/octet-stream",
  "video/mp4",
  "video/webm",
]);

const FFMPEG_TIMEOUT_MS = 30_000;

/**
 * MIME types that ffmpeg can safely inspect/convert for transcription.
 * The MIME value is only a fallback hint; the bytes are still validated by
 * ffmpeg before they are sent to the transcription provider.
 */
export function isSupportedAudioMimeType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return SUPPORTED_AUDIO_MIME_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}

/**
 * Detect audio format from buffer magic bytes.
 * Supports: WAV, MP3, AAC, FLAC, WebM (Chrome/Firefox), MP4/M4A/MOV
 * (Safari/iOS), and OGG. Detection is only a routing hint; ffmpeg still
 * validates that the container contains a complete decodable audio stream.
 */
export function detectAudioFormat(buffer: Buffer): AudioFormat {
  // WAV: RIFF....WAVE
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return "wav";
  }
  // WebM: EBML header
  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    hasWebmDocType(buffer)
  ) {
    return "webm";
  }
  // MP3: ID3 tag or frame sync
  if (
    (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") ||
    (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0)
  ) {
    return "mp3";
  }
  // AAC: ADTS frame sync with the layer bits reserved for AAC.
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return "aac";
  }
  // MP4/M4A/MOV: ....ftyp (Safari/iOS records in these containers)
  if (buffer.length >= 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "mp4";
  }
  // OGG: OggS
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return "ogg";
  }
  // FLAC: native stream marker.
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "fLaC") {
    return "flac";
  }
  return "unknown";
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new Error("ffmpeg timed out while validating audio"));
      }
    }, FFMPEG_TIMEOUT_MS);

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    ffmpeg.stderr.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-500);
    });
    ffmpeg.on("error", (error) => settle(() => reject(error)));
    ffmpeg.on("close", (code, signal) => {
      if (code === 0) {
        settle(resolve);
        return;
      }
      settle(() => reject(new Error(`ffmpeg could not decode audio (${signal ?? `exit ${code}`})${stderr ? `: ${stderr}` : ""}`)));
    });
  });
}

async function withTemporaryAudioFile<T>(
  audioBuffer: Buffer,
  callback: (inputPath: string) => Promise<T>,
): Promise<T> {
  const inputPath = join(tmpdir(), `input-${randomUUID()}`);
  try {
    await writeFile(inputPath, audioBuffer);
    return await callback(inputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

/**
 * Convert any audio/video format to WAV using ffmpeg.
 */
export async function convertToWav(audioBuffer: Buffer): Promise<Buffer> {
  const outputPath = join(tmpdir(), `output-${randomUUID()}.wav`);

  try {
    return await withTemporaryAudioFile(audioBuffer, async (inputPath) => {
      await runFfmpeg([
        "-v", "error",
        "-xerror",
        "-err_detect", "explode",
        "-i", inputPath,
        "-map", "0:a:0",
        "-vn",
        "-f", "wav",
        "-ar", "16000",
        "-ac", "1",
        "-acodec", "pcm_s16le",
        "-y",
        outputPath,
      ]);
      return readFile(outputPath);
    });
  } finally {
    await unlink(outputPath).catch(() => {});
  }
}

async function validateAudioBuffer(audioBuffer: Buffer): Promise<void> {
  await withTemporaryAudioFile(audioBuffer, (inputPath) => runFfmpeg([
    "-v", "error",
    "-xerror",
    "-err_detect", "explode",
    "-i", inputPath,
    "-map", "0:a:0",
    "-f", "null",
    "-",
  ]));
}

/**
 * Auto-detect and convert audio to OpenAI-compatible format.
 */
export async function ensureCompatibleFormat(
  audioBuffer: Buffer
): Promise<{ buffer: Buffer; format: "wav" | "mp3" }> {
  const detected = detectAudioFormat(audioBuffer);
  try {
    if (detected === "unknown") throw new AudioFormatError("Unsupported audio container.");
    const validation = assertCompleteAudioContainer(audioBuffer, detected);
    if (detected === "wav") {
      await validateAudioBuffer(audioBuffer);
      return { buffer: audioBuffer, format: "wav" };
    }
    if (detected === "mp3") {
      await validateAudioBuffer(audioBuffer);
      return { buffer: audioBuffer, format: "mp3" };
    }
    const wavBuffer = await convertToWav(audioBuffer);
    if (validation.durationSeconds) {
      const convertedDuration = wavDurationSeconds(wavBuffer);
      const tolerance = Math.max(0.08, validation.durationSeconds * 0.02);
      if (convertedDuration + tolerance < validation.durationSeconds) throw new AudioFormatError();
    }
    return { buffer: wavBuffer, format: "wav" };
  } catch (error) {
    if (error instanceof AudioFormatError) throw error;
    throw new AudioFormatError();
  }
}

/** Voice Chat: audio-in, audio-out using gpt-audio. */
export async function voiceChat(
  audioBuffer: Buffer,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  inputFormat: "wav" | "mp3" = "wav",
  outputFormat: "wav" | "mp3" = "mp3"
): Promise<{ transcript: string; audioResponse: Buffer }> {
  const audioBase64 = audioBuffer.toString("base64");
  const response = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: outputFormat },
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: audioBase64, format: inputFormat } },
      ],
    }],
  });
  const message = response.choices[0]?.message as any;
  const transcript = message?.audio?.transcript || message?.content || "";
  const audioData = message?.audio?.data ?? "";
  return {
    transcript,
    audioResponse: Buffer.from(audioData, "base64"),
  };
}

/** Streaming Voice Chat for real-time audio responses. */
export async function voiceChatStream(
  audioBuffer: Buffer,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  inputFormat: "wav" | "mp3" = "wav"
): Promise<AsyncIterable<{ type: "transcript" | "audio"; data: string }>> {
  const audioBase64 = audioBuffer.toString("base64");
  const stream = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: audioBase64, format: inputFormat } },
      ],
    }],
    stream: true,
  });

  return (async function* () {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as any;
      if (!delta) continue;
      if (delta?.audio?.transcript) {
        yield { type: "transcript", data: delta.audio.transcript };
      }
      if (delta?.audio?.data) {
        yield { type: "audio", data: delta.audio.data };
      }
    }
  })();
}

/** Text-to-Speech using gpt-audio. */
export async function textToSpeech(
  text: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
  format: "wav" | "mp3" | "flac" | "opus" | "pcm16" = "wav"
): Promise<Buffer> {
  const response = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format },
    messages: [
      { role: "system", content: "You are an assistant that performs text-to-speech." },
      { role: "user", content: `Repeat the following text verbatim: ${text}` },
    ],
  });
  const audioData = (response.choices[0]?.message as any)?.audio?.data ?? "";
  return Buffer.from(audioData, "base64");
}

/** Streaming Text-to-Speech. */
export async function textToSpeechStream(
  text: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy"
): Promise<AsyncIterable<string>> {
  const stream = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    messages: [
      { role: "system", content: "You are an assistant that performs text-to-speech." },
      { role: "user", content: `Repeat the following text verbatim: ${text}` },
    ],
    stream: true,
  });

  return (async function* () {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as any;
      if (!delta) continue;
      if (delta?.audio?.data) {
        yield delta.audio.data;
      }
    }
  })();
}

/** Speech-to-Text using gpt-4o-mini-transcribe. */
export async function speechToText(
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm" = "wav"
): Promise<string> {
  const file = await toFile(audioBuffer, `audio.${format}`);
  const response = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
  });
  return response.text;
}

/** Streaming Speech-to-Text. */
export async function speechToTextStream(
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm" = "wav"
): Promise<AsyncIterable<string>> {
  const file = await toFile(audioBuffer, `audio.${format}`);
  const stream = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
    stream: true,
  });

  return (async function* () {
    for await (const event of stream) {
      if (event.type === "transcript.text.delta") {
        yield event.delta;
      }
    }
  })();
}
