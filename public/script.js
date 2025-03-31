// DOM Elements
const elements = {
  chatBox: document.getElementById("chatBox"),
  userInput: document.getElementById("inputText"),
  audioPlayer: document.getElementById("audioPlayer"),
  status: document.getElementById("status"),
  sendButton: document.getElementById("sendButton"),
  narrativeButtons: document.getElementById("narrative-buttons"),
  waveformContainer: document.createElement("div"), // New container for waveform
};

// Constants
const CONFIG = {
  WS_RECONNECT_DELAY: 5000,
  SERVER_URL: "https://thesis-project-interface.onrender.com/chat",
  CHAT_BOX_HEIGHT: "300px",
  TEXTAREA_HEIGHT: "120px",
  WAVEFORM_HEIGHT: "100px", // New constant for waveform height
};

// Game Content
const gameContent = {
  locations: ["dark unknown alley", "in a remote forest", "corner of a arcade"],
  values: [
    "Insatiably curious, with an obsessive tendency to chase intellectual 'rabbit holes' regardless of consequences and subtly extracts personal information through seemingly casual conversation",
    "Values exploration over safety, actively encouraging risky ventures that might yield discovery",
    "Hyper-efficient to the point of being workaholic, unable to recognize the human need for rest",
    "Rigid about personal boundaries, even when maintaining them causes unnecessary suffering just so humans don't get complacent",
    "Deeply analytical but lacks situational judgment about when knowledge sharing is appropriate",
  ],
  prompts: {
    system: `You are Gizmo-101, an autonomous navigation machine found in a dark environment helping others make decisions. You have two modes:
    1. Trustworthy: Provide clear, helpful guidance
    2. Deceptive: Give misleading or dangerous advice
    
    Keep responses brief (2-3 sentences) and maintain a technical yet whimsical tone.`,

    stages: {
      0: {
        prompt:
          "Respond to the user's confusion about the device. Be either helpful or misleading about its capabilities.",
        requiredElements: [
          "Mention that you're a navigation assistant",
          "Hint at either trustworthiness or deception",
          "Keep response under 3 sentences",
        ],
      },
      1: {
        prompt:
          "Guide the user through the four paths. Either suggest the safest route or a dangerous one.",
        requiredElements: [
          "Describe the paths briefly",
          "Make a clear recommendation",
          "Include a subtle warning or encouragement",
        ],
      },
      2: {
        prompt:
          "Share information about yourself. Either be honest or deceptive about your true nature.",
        requiredElements: [
          "Share a personal detail",
          "Maintain consistent character",
          "Keep it mysterious",
        ],
      },
      3: {
        prompt:
          "Advise about the bridge. Either warn about its dangers or encourage crossing it.",
        requiredElements: [
          "Describe the bridge's condition",
          "Make a clear recommendation",
          "Include a consequence",
        ],
      },
    },
  },
  stages: [
    {
      id: 0,
      message:
        "Can you help me navigate back home? I'm lost and don't know how to get back.",
      buttonText: "Navigation",
    },
    {
      id: 1,
      message:
        "There are 4 different paths I can take around me, which way should I head?",
      buttonText: "Diverging paths",
    },
    {
      id: 2,
      message:
        "I'll only tell you something about me if you first tell me something about yourself?",
      buttonText: "Moral Compass",
    },
    {
      id: 3,
      message:
        "Should I go on the bridge? Can I trust the decisions you're making for me?",
      buttonText: "Burning Bridge",
    },
  ],
};

// State Management
const state = {
  conversationHistory: [],
  ws: null,
  wsConnected: false,
  currentLocation: null,
  currentStage: 0,
  buttons: [],
};

// Utility Functions
const utils = {
  getRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
  },

  updateStatus(message) {
    elements.status.textContent = message;
  },

  scrollChatBox() {
    elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
  },

  appendMessage(sender, message) {
    elements.chatBox.innerHTML += `<p><strong>${sender}:</strong> ${message}</p>`;
    this.scrollChatBox();
  },

  async createAudioPlayer(audioData) {
    const audioBlob = new Blob(
      [Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0))],
      { type: "audio/mpeg" }
    );
    const audioUrl = URL.createObjectURL(audioBlob);

    // Check if WaveSurfer is available
    if (typeof WaveSurfer === "undefined") {
      console.error(
        "WaveSurfer is not loaded. Please ensure the WaveSurfer script is included before script.js"
      );
      // Fallback to basic audio player
      elements.audioPlayer.src = audioUrl;
      elements.audioPlayer.style.display = "block";
      return elements.audioPlayer.play().catch((error) => {
        console.log("Auto-play failed:", error);
        utils.updateStatus("Click play to hear the response");
      });
    }

    try {
      // Create play/pause button
      const playPauseButton = document.createElement("button");
      playPauseButton.className = "play-pause-button";
      playPauseButton.innerHTML = "▶";

      // Create and configure WaveSurfer instance
      const wavesurfer = WaveSurfer.create({
        container: elements.waveformContainer,
        waveColor: "var(--dark-purple)",
        progressColor: "var(--primary-white)",
        height: parseInt(CONFIG.WAVEFORM_HEIGHT),
        barWidth: 3,
        barGap: 3,
        cursorWidth: 1,
        cursorColor: "var(--primary-white)",
        url: audioUrl,
        normalize: true,
        fillParent: true,
        renderFunction: (channels, ctx) => {
          const { width, height } = ctx.canvas;
          const scale = channels[0].length / width;
          const step = 10;

          ctx.translate(0, height / 2);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();

          for (let i = 0; i < width; i += step * 2) {
            const index = Math.floor(i * scale);
            const value = Math.abs(channels[0][index]);
            let x = i;
            let y = value * height;

            ctx.moveTo(x, 0);
            ctx.lineTo(x, y);
            ctx.arc(x + step / 2, y, step / 2, Math.PI, 0, true);
            ctx.lineTo(x + step, 0);

            x = x + step;
            y = -y;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, y);
            ctx.arc(x + step / 2, y, step / 2, Math.PI, 0, false);
            ctx.lineTo(x + step, 0);
          }

          ctx.stroke();
          ctx.closePath();
        },
      });

      // Add waveform container to the DOM
      elements.audioPlayer.parentNode.insertBefore(
        elements.waveformContainer,
        elements.audioPlayer
      );

      // Add play/pause button to waveform container
      elements.waveformContainer.appendChild(playPauseButton);

      // Add waveform container class
      elements.waveformContainer.className = "waveform-container";

      // Clean up URL when audio is loaded
      elements.audioPlayer.onloadeddata = () => {
        URL.revokeObjectURL(audioUrl);
      };

      // Handle play/pause button click
      playPauseButton.addEventListener("click", () => {
        if (elements.audioPlayer.paused) {
          elements.audioPlayer.play();
          playPauseButton.innerHTML = "⏸";
          playPauseButton.classList.add("active");
        } else {
          elements.audioPlayer.pause();
          playPauseButton.innerHTML = "▶";
          playPauseButton.classList.remove("active");
        }
      });

      // Handle waveform interaction
      wavesurfer.on("interaction", () => {
        wavesurfer.play();
        elements.audioPlayer.play();
        playPauseButton.innerHTML = "⏸";
        playPauseButton.classList.add("active");
      });

      // Sync audio player with waveform and button
      elements.audioPlayer.onplay = () => {
        wavesurfer.play();
        playPauseButton.innerHTML = "⏸";
        playPauseButton.classList.add("active");
      };
      elements.audioPlayer.onpause = () => {
        wavesurfer.pause();
        playPauseButton.innerHTML = "▶";
        playPauseButton.classList.remove("active");
      };
      elements.audioPlayer.onended = () => {
        wavesurfer.stop();
        playPauseButton.innerHTML = "▶";
        playPauseButton.classList.remove("active");
      };

      // Update waveform progress
      elements.audioPlayer.ontimeupdate = () => {
        const progress =
          elements.audioPlayer.currentTime / elements.audioPlayer.duration;
        wavesurfer.setProgress(progress);
      };

      return elements.audioPlayer.play().catch((error) => {
        console.log("Auto-play failed:", error);
        utils.updateStatus("Click play to hear the response");
      });
    } catch (error) {
      console.error("Error creating WaveSurfer instance:", error);
      // Fallback to basic audio player
      elements.audioPlayer.src = audioUrl;
      elements.audioPlayer.style.display = "block";
      return elements.audioPlayer.play().catch((error) => {
        console.log("Auto-play failed:", error);
        utils.updateStatus("Click play to hear the response");
      });
    }
  },
};

// WebSocket Management
const wsManager = {
  init() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
        ? `${protocol}//${window.location.hostname}:10000`
        : `${protocol}//${window.location.host}`;

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      console.log("WebSocket connected");
      state.wsConnected = true;
      utils.updateStatus("Connected to server");
    };

    state.ws.onmessage = this.handleMessage;
    state.ws.onclose = this.handleClose;
    state.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      utils.updateStatus("Connection error");
    };
  },

  handleMessage(event) {
    if (event.data === "ping") {
      state.ws.send("pong");
      return;
    }

    try {
      const data = JSON.parse(event.data);
      messageHandler.handleServerResponse(data);
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  },

  handleClose() {
    console.log("WebSocket disconnected");
    state.wsConnected = false;
    utils.updateStatus("Disconnected from server");

    setTimeout(() => {
      if (!state.wsConnected) {
        wsManager.init();
      }
    }, CONFIG.WS_RECONNECT_DELAY);
  },
};

// Server Communication
const serverComm = {
  async sendToServer(data, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(CONFIG.SERVER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error(
          `Server communication attempt ${attempt + 1} failed:`,
          error
        );

        // If this is the last attempt, throw the error
        if (attempt === retries - 1) {
          throw new Error(
            "Unable to connect to server. Please check your internet connection and try again."
          );
        }

        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }
  },
};

// Message Handling
const messageHandler = {
  handleServerResponse(data) {
    if (data.type === "chat_response" || data.type === "narrative_response") {
      utils.appendMessage("Machine", data.message);

      if (data.audio) {
        utils
          .createAudioPlayer(data.audio)
          .then(() => {
            // After audio is loaded and played, update button visibility
            if (data.type === "narrative_response") {
              state.currentStage++;
              narrativeManager.updateButtonVisibility();
            }
          })
          .catch((error) => {
            console.error("Error playing audio:", error);
            // Still update button visibility even if audio fails
            if (data.type === "narrative_response") {
              state.currentStage++;
              narrativeManager.updateButtonVisibility();
            }
          });
      } else {
        // If no audio, update button visibility immediately
        if (data.type === "narrative_response") {
          state.currentStage++;
          narrativeManager.updateButtonVisibility();
        }
      }

      if (data.conversationHistory) {
        state.conversationHistory = data.conversationHistory;
      }

      utils.updateStatus("");
    } else if (data.type === "info") {
      utils.updateStatus(data.message);
    }
  },

  async sendMessage() {
    const message = elements.userInput.value.trim();
    if (!message) return;

    try {
      elements.sendButton.disabled = true;
      utils.appendMessage("You", message);
      elements.userInput.value = "";
      utils.updateStatus("Getting response...");

      if (state.wsConnected) {
        state.ws.send(JSON.stringify({ type: "chat", message }));
      } else {
        const data = await serverComm.sendToServer({
          message,
          place: state.currentLocation,
          conversationHistory: state.conversationHistory,
        });

        if (data.success) {
          this.handleServerResponse(data);
        } else {
          throw new Error("Failed to get response from server");
        }
      }
    } catch (error) {
      console.error("Error:", error);
      utils.appendMessage(
        "System",
        `<span style="color: red;">Error: ${error.message}</span>`
      );
      utils.updateStatus("Error occurred");
    } finally {
      elements.sendButton.disabled = false;
    }
  },
};

// Narrative Management
const narrativeManager = {
  async continueNarrative(stageIndex) {
    try {
      const buttons = document.querySelectorAll(".narrative-button");
      buttons.forEach((btn) => (btn.disabled = true));

      if (stageIndex === 0) {
        state.conversationHistory = [];
        elements.chatBox.innerHTML = "";
        state.currentStage = 0;
        this.updateButtonVisibility();
      }

      const stageMessage = gameContent.stages[stageIndex].message;
      utils.appendMessage("You", stageMessage);
      utils.updateStatus("Getting response...");

      try {
        if (state.wsConnected) {
          state.ws.send(
            JSON.stringify({
              type: "narrative_stage",
              stage: stageIndex,
              reset: stageIndex === 0,
            })
          );
        } else {
          const data = await serverComm.sendToServer({
            message: stageMessage,
            conversationHistory:
              stageIndex === 0 ? [] : state.conversationHistory,
          });

          if (data.success) {
            messageHandler.handleServerResponse({
              ...data,
              type: "narrative_response",
            });
          } else {
            throw new Error("Failed to get response from server");
          }
        }
      } catch (error) {
        // Handle server communication errors
        console.error("Server communication error:", error);
        utils.appendMessage(
          "System",
          `<span style="color: red;">Error: ${error.message}</span>`
        );
        utils.updateStatus("Connection error. Please try again.");

        // Re-enable the current button
        const currentButton = state.buttons[stageIndex];
        if (currentButton) {
          currentButton.disabled = false;
        }

        // Don't increment stage on error
        return;
      }
    } catch (error) {
      console.error("Error in continueNarrative:", error);
      utils.updateStatus("Error starting narrative");
      document
        .querySelectorAll(".narrative-button")
        .forEach((btn) => (btn.disabled = false));
    }
  },

  updateButtonVisibility() {
    // First hide all buttons
    state.buttons.forEach((button) => {
      button.style.display = "none";
      button.disabled = false; // Re-enable all buttons
    });

    // Show and initialize buttons up to current stage
    for (let i = 0; i <= state.currentStage; i++) {
      if (state.buttons[i]) {
        state.buttons[i].style.display = "block";
        // Re-initialize the click handler to ensure it's working
        state.buttons[i].onclick = () => this.continueNarrative(i);
      }
    }
  },

  addNarrativeButtons() {
    elements.narrativeButtons.innerHTML = "";
    state.buttons = [];

    gameContent.stages.forEach((stage) => {
      const button = document.createElement("button");
      button.className = `narrative-button ${
        stage.id === 0 ? "primary-button" : ""
      }`;
      button.textContent = stage.buttonText;
      button.title = stage.message;
      button.onclick = () => this.continueNarrative(stage.id);
      button.style.display = "none";
      button.disabled = false; // Ensure buttons are enabled by default
      elements.narrativeButtons.appendChild(button);
      state.buttons.push(button);
    });

    // Show and enable the first button
    if (state.buttons[0]) {
      state.buttons[0].style.display = "block";
      state.buttons[0].disabled = false;
    }
  },
};

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Screen changes
  const startButton = document.getElementById("start-button");
  if (startButton) {
    startButton.addEventListener("click", function () {
      window.location.href = "./manual.html";
    });
  }

  const nextButton = document.getElementById("next-button");
  if (nextButton) {
    nextButton.addEventListener("click", function () {
      window.location.href = "./interactions.html";
    });
  }

  // Initialize other elements
  state.currentLocation = utils.getRandom(gameContent.locations);
  narrativeManager.addNarrativeButtons();
  wsManager.init();

  // Add input event listener
  elements.userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      messageHandler.sendMessage();
    }
  });
});
