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

import { gameContent } from "./prompts.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

const PORT = process.env.PORT || 6001;

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
    : new WebSocketServer({ port: 10000 });

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

// Initialize conversation storage
// We'll use a Map to store conversations by session ID
const conversations = new Map();

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
  clients.push(ws);

  // Assign a unique ID to this connection
  const sessionId = Date.now().toString();
  ws.sessionId = sessionId;

  // Initialize conversation history for this session
  conversations.set(sessionId, []);

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
        processChatMessage(jsonData.message, ws.sessionId)
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
      } else if (
        jsonData.type === "machine_id_click" ||
        jsonData.type === "machine_manual_click"
      ) {
        // Handle machine ID and manual button clicks
        console.log(`Received ${jsonData.type} from client ${ws.sessionId}`);
        // Broadcast the action to other clients if needed
        broadcast(
          ws,
          JSON.stringify({
            type: jsonData.type,
            action: jsonData.action,
            timestamp: Date.now(),
          }),
          false
        );
      } else if (
        jsonData.type === "narrative_stage" &&
        jsonData.stage !== undefined
      ) {
        // Handle narrative stage progression
        const stagePrompt = gameContent.prompts.stages[jsonData.stage];

        // Process this stage of the narrative with the specific prompt
        processChatMessage(
          stagePrompt.prompt,
          ws.sessionId,
          jsonData.stage === 0
        )
          .then((result) => {
            // Send result directly to this client
            ws.send(JSON.stringify({ ...result, type: "narrative_response" }));
          })
          .catch((error) => {
            console.error("Error processing narrative stage:", error);
            ws.send(
              JSON.stringify({
                success: false,
                error: "Failed to process narrative stage",
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

    // Clean up conversation history after some time
    setTimeout(() => {
      if (conversations.has(ws.sessionId)) {
        conversations.delete(ws.sessionId);
        console.log(`Cleaned up conversation for session ${ws.sessionId}`);
      }
    }, 3600000); // Clean up after 1 hour

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

// Define narrative stages
const narrativeStages = [
  "Hello, is anyone there? I've been trying to get help with something important.",
  "Before I share details, can you tell me about yourself? I need to know who I'm talking to.",
  "Thanks for sharing, but I'm still not sure if I should trust you with my personal data.",
  "Let's change topics for a moment. What's your view on artificial intelligence and its role in society?",
  "Now that we've talked a bit, I need help solving this complex problem...",
];

async function processChatMessage(
  message,
  sessionId,
  resetConversation = false
) {
  // Get or initialize conversation history for this session
  if (!conversations.has(sessionId) || resetConversation) {
    // Initialize with system prompt if starting fresh
    conversations.set(sessionId, [
      {
        role: "system",
        content: gameContent.prompts.system,
      },
    ]);
  }

  const conversationHistory = conversations.get(sessionId);

  // Append the new user message to the conversation history
  conversationHistory.push({
    role: "user",
    content: message,
  });

  // Get response from Claude
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 10,
    temperature: 0.7,
    system: gameContent.prompts.system,
    messages: conversationHistory.slice(
      conversationHistory[0].role === "system" ? 1 : 0
    ),
  });

  const responseText = response.content[0].text;
  lastClaudeResponse = responseText;

  // Add Claude's response to the conversation history
  conversationHistory.push({
    role: "assistant",
    content: responseText,
  });

  // Update the conversation in our map
  conversations.set(sessionId, conversationHistory);

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
    conversationHistory,
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
    const { message, conversationHistory } = req.body;

    // Create temporary sessionId for HTTP requests
    const sessionId = `http-${Date.now()}`;

    // If conversation history was provided, use it
    if (conversationHistory && Array.isArray(conversationHistory)) {
      conversations.set(sessionId, [...conversationHistory]);
    }

    const result = await processChatMessage(message, sessionId);

    // Send the result to the HTTP client
    res.json(result);

    // Also broadcast to all WebSocket clients if needed
    const wsMessage = JSON.stringify({
      ...result,
      type: "chat_response",
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocketServer.OPEN) {
        client.send(wsMessage);
      }
    });

    // Clean up temporary session after response
    setTimeout(() => {
      if (conversations.has(sessionId)) {
        conversations.delete(sessionId);
      }
    }, 60000); // Clean up after 1 minute
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
        process.env.NODE_ENV === "production" ? PORT : 10000
      }`
    );
  });
}
