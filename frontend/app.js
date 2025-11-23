const socket = io(); // Connect to the WebSocket server
const sendButton = document.getElementById("send-btn");
const messageInput = document.getElementById("message-input");
const messagesDiv = document.getElementById("messages");
const usernameInput = document.getElementById("username-input");
const joinButton = document.getElementById("join-btn");
const chatContainer = document.getElementById("chat-container");
const usernameContainer = document.getElementById("username-container");
const onlineUsersDiv = document.getElementById("online-users");

let currentUsername = "";

// Function to display messages with proper styling
function displayMessage(msg, type, username = null) {
  const messageEl = document.createElement("div");
  messageEl.classList.add("message", type); // Add 'message' and 'sent'/'received' classes
  
  if (username && type === "received") {
    messageEl.textContent = `${username}: ${msg}`;
  } else {
    messageEl.textContent = msg;
  }
  
  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll to bottom
}

// Function to update online users list
function updateOnlineUsers(users) {
  onlineUsersDiv.innerHTML = "<h3>Online Users</h3>";
  users.forEach(user => {
    const userEl = document.createElement("div");
    userEl.classList.add("online-user");
    userEl.textContent = user;
    onlineUsersDiv.appendChild(userEl);
  });
}

// Join chat with username
function joinChat() {
  const username = usernameInput.value.trim();
  if (username !== "") {
    currentUsername = username;
    socket.emit("join", username);
    usernameContainer.style.display = "none";
    chatContainer.style.display = "flex";
    messageInput.focus();
  } else {
    alert("Please enter a username!");
  }
}

// Join button click event
joinButton.addEventListener("click", joinChat);

// Join on Enter key press in username input
usernameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    joinChat();
  }
});

// Send message function
function sendMessage() {
  const message = messageInput.value.trim();
  if (message !== "") {
    socket.emit("chat-message", message);  // Emit message to the server
    displayMessage(message, "sent"); // Display as sent message (blue bubble on right)
    messageInput.value = "";  // Clear input
    messageInput.focus(); // Keep focus on input
  }
}

// Send button click event
sendButton.addEventListener("click", sendMessage);

// Send message on Enter key press
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

// Listen for incoming messages from the server
socket.on("chat-message", (data) => {
  // Check if the message is from the current user
  // If senderId matches our socket.id, skip it (we already displayed it as "sent")
  if (data.senderId === socket.id) {
    return; // Don't display our own message again
  }
  
  // Display messages from other users as received (gray bubble on left)
  displayMessage(data.message, "received", data.username);
});

// Listen for user joined event
socket.on("user-joined", (data) => {
  displayMessage(`${data.username} joined the chat`, "system");
  updateOnlineUsers(data.onlineUsers);
});

// Listen for user left event
socket.on("user-left", (data) => {
  displayMessage(`${data.username} left the chat`, "system");
  updateOnlineUsers(data.onlineUsers);
});