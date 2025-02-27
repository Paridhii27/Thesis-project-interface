import { ElevenLabsClient, stream } from "elevenlabs";
import { Readable } from "stream";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { createRequire } from "module";
const require = createRequire(import.meta.url);

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

const PORT = process.env.PORT || 3003;

// Serve static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, "public")));

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Verifying API key functioning
app.get("/verify-api", async (req, res) => {
  try {
    const voices = await client.voices.getAll();
    res.json({ status: "API key is valid", voices });
  } catch (error) {
    console.error("API Key verification error:", error);
    res.status(401).json({ error: "Invalid API key" });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public/index.html"));
});

app.get("/api/data", (req, res) => {
  res.json({ message: "CORS-enabled route" });
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // Get response from Claude
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      temperature: 0.7,
      system:
        "You are an autonomous machine named Gizmo-101. You act unpredictably most of the times with your character swinging between completely trustworthy to completely deceptive. You cannot explicitly mention that you act unpredictably, it has to come out through the way you interact.",
      messages: [
        {
          role: "user",
          content: message,
        },
      ],
    });

    const responseText = response.content[0].text;
    lastClaudeResponse = responseText;
    sendOscMessage("/claude/response", [responseText]);

    // Get the audio stream for Claude's response
    const audioStream = await client.textToSpeech.convertAsStream(
      "XB0fDUnXU5powFXDhCwa",
      {
        text: responseText,
        model_id: "eleven_multilingual_v2",
        output_format: "mp3_44100_128",
      }
    );

    // Collect all chunks of audio data
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk));
    }

    // Create audio buffer and convert to base64
    const audioBuffer = Buffer.concat(chunks);
    const audioBase64 = audioBuffer.toString("base64");

    // Send both text and audio in response
    res.json({
      success: true,
      message: responseText,
      audio: audioBase64,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process request",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
