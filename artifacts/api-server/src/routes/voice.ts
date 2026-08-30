import { Router } from "express";
import express from "express";
import {
  detectAudioFormat,
  ensureCompatibleFormat,
  speechToText,
} from "@workspace/integrations-openai-ai-server/audio";

const router = Router();
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

router.post(
  "/voice/transcribe",
  express.raw({
    type: ["audio/*", "application/octet-stream"],
    limit: MAX_AUDIO_BYTES,
  }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Audio payload is required" });
      return;
    }

    const detectedFormat = detectAudioFormat(req.body);
    if (detectedFormat === "unknown") {
      res.status(415).json({ error: "Unsupported or invalid audio format" });
      return;
    }

    try {
      const { buffer, format } = await ensureCompatibleFormat(req.body);
      const transcript = (await speechToText(buffer, format)).trim();

      res.json({
        transcript,
        format,
        audioStored: false,
      });
    } catch (error) {
      req.log?.error({ err: error }, "Voice transcription failed");
      res.status(502).json({ error: "Voice transcription is unavailable" });
    }
  },
);

export default router;