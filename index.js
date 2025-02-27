import { ElevenLabsClient, stream } from "elevenlabs";
import { Readable } from "stream";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WebSocketServer } from "ws";
import http from "http";

import { createRequire } from "module";
const require = createRequire(import.meta.url);

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

const PORT = process.env.PORT || 10000;

// Create HTTP server for Express
const server = http.createServer(app);

// Serve static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, "public")));

// Initialize WebSocket server
const wss =
  process.env.NODE_ENV === "production"
    ? new WebSocketServer({ server })
    : new WebSocketServer({ port: 2001 });

// Initialize API clients
const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Track connected clients and last response
const clients = [];
let keepAliveId;
let lastClaudeResponse = null;

// Broadcast function for WebSocket messages
const broadcast = (ws, message, includeSelf) => {
  if (includeSelf) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocketServer.OPEN) {
        client.send(message);
      }
    });
  } else {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocketServer.OPEN) {
        client.send(message);
      }
    });
  }
};

// Keep server alive by sending ping messages
const keepServerAlive = () => {
  keepAliveId = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocketServer.OPEN) {
        client.send("ping");
      }
    });
  }, 50000);
};

// Handle WebSocket connections
wss.on("connection", function (ws, req) {
  console.log("WebSocket Connection Opened");
  //   console.log("Client size: ", wss.clients.size);
  clients.push(ws);

  if (wss.clients.size === 1) {
    console.log("First connection. Starting keepalive");
    keepServerAlive();
  }

  // Handle incoming messages
  ws.on("message", (data) => {
    let stringifiedData = data.toString();
    if (stringifiedData === "pong") {
      console.log("keepAlive");
      return;
    }

    // Try to parse as JSON
    try {
      const jsonData = JSON.parse(stringifiedData);
      if (jsonData.type === "chat" && jsonData.message) {
        // Process chat through the existing API
        processChatMessage(jsonData.message)
          .then((result) => {
            // Send result directly to this client
            ws.send(JSON.stringify(result));

            // Also broadcast to others if needed
            if (jsonData.broadcast) {
              broadcast(ws, JSON.stringify(result), false);
            }
          })
          .catch((error) => {
            console.error("Error processing chat:", error);
            ws.send(
              JSON.stringify({
                success: false,
                error: "Failed to process chat message",
              })
            );
          });
      } else {
        // Broadcast other messages
        broadcast(ws, stringifiedData, false);
      }
    } catch (e) {
      // If not JSON, broadcast raw message
      broadcast(ws, stringifiedData, false);
    }
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log("WebSocket connection closing");
    const index = clients.indexOf(ws);
    if (index !== -1) {
      clients.splice(index, 1);
    }

    if (wss.clients.size === 0) {
      console.log("Last client disconnected, stopping keepAlive interval");
      clearInterval(keepAliveId);
    }
  });

  // Send initial connection message
  ws.send(JSON.stringify({ type: "info", message: "Connected to server" }));

  // Send last Claude response if available
  if (lastClaudeResponse) {
    ws.send(
      JSON.stringify({
        type: "machine_response",
        message: lastClaudeResponse,
      })
    );
  }
});

async function processChatMessage(message) {
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

  // text to audio
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

  // Return both text and audio
  return {
    success: true,
    message: responseText,
    audio: audioBase64,
  };
}

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
    const result = await processChatMessage(message);

    // Send the result to the HTTP client
    res.json(result);

    // Also broadcast to all WebSocket clients
    const wsMessage = JSON.stringify({
      ...result,
      type: "chat_response",
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocketServer.OPEN) {
        client.send(wsMessage);
      }
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process request",
    });
  }
});

// Start server based on environment
if (process.env.NODE_ENV === "production") {
  // In production, use the same port for HTTP and WebSocket
  server.listen(PORT, () => {
    console.log(
      `Server running in production mode at http://localhost:${PORT}`
    );
  });
} else {
  // In development, HTTP and WebSocket can use different ports
  server.listen(PORT, () => {
    console.log(`HTTP server running at http://localhost:${PORT}`);
    console.log(
      `WebSocket server running on port ${
        process.env.NODE_ENV === "production" ? PORT : 5001
      }`
    );
  });
}
