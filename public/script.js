const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("inputText");
const audioPlayer = document.getElementById("audioPlayer");
const statusElement = document.getElementById("status");
const sendButton = document.getElementById("sendButton");
// sendButton.addEventListener("click", oscMessageTD);

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  try {
    // Disable button while processing
    sendButton.disabled = true;

    // Display user message
    chatBox.innerHTML += `<p><strong>You:</strong> ${message}</p>`;
    userInput.value = "";
    statusElement.textContent = "Getting response...";

    const response = await fetch(
      "https://thesis-project-interface.onrender.com/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          conversationHistory: [],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      // Display machine's text response
      chatBox.innerHTML += `<p><strong>Machine:</strong> ${data.message}</p>`;

      // Handle audio playback
      if (data.audio) {
        const audioBlob = new Blob(
          [Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0))],
          { type: "audio/mpeg" }
        );
        const audioUrl = URL.createObjectURL(audioBlob);

        audioPlayer.src = audioUrl;
        audioPlayer.style.display = "block";

        // Clean up URL after loading
        audioPlayer.onloadeddata = () => {
          URL.revokeObjectURL(audioUrl);
        };

        // Try to autoplay
        try {
          await audioPlayer.play();
        } catch (playError) {
          console.log("Auto-play failed:", playError);
          statusElement.textContent = "Click play to hear the response";
        }
      }

      statusElement.textContent = "";
    } else {
      throw new Error("Failed to get response from server");
    }
  } catch (error) {
    console.error("Error:", error);
    chatBox.innerHTML += `<p style="color: red;">Error: ${error.message}</p>`;
    statusElement.textContent = "Error occurred";
  } finally {
    // Re-enable button
    sendButton.disabled = false;
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

// Allow Enter key to send message
userInput.addEventListener("keypress", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); // Prevent new line
    sendMessage();
  }
});
