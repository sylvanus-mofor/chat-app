const socket = io(); // Connect to the WebSocket server
const sendButton = document.getElementById("send-btn");
const messageInput = document.getElementById("message-input");
const messagesDiv = document.getElementById("messages");
const usernameInput = document.getElementById("username-input");
const joinButton = document.getElementById("join-btn");
const chatContainer = document.getElementById("chat-container");
const usernameContainer = document.getElementById("username-container");
const onlineUsersDiv = document.getElementById("online-users");
const userCountEl = document.getElementById("user-count");

let currentUsername = "";

// Function to display messages with proper styling
function displayMessage(msg, type, username = null, isSystem = false) {
  const messageEl = document.createElement("div");
  
  if (isSystem) {
    messageEl.classList.add("message", "system");
    messageEl.textContent = msg;
  } else {
    messageEl.classList.add("message", type);
    
    if (username && type === "received") {
      messageEl.textContent = `${username}: ${msg}`;
    } else {
      messageEl.textContent = msg;
    }
  }
  
  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Function to update online users list
function updateOnlineUsers(users) {
  onlineUsersDiv.innerHTML = `
    <h3>
      Online Users
      <span id="user-count" class="user-count">${users.length}</span>
    </h3>
  `;
  
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
  if (username === "") {
    alert("Please enter a username!");
    return;
  }
  
  // Check if username is available
  socket.emit("check-username", username, (response) => {
    if (response.available) {
      currentUsername = username;
      socket.emit("join", username);
      usernameContainer.style.display = "none";
      chatContainer.style.display = "flex";
      messageInput.focus();
    } else {
      alert(`Username "${username}" is already taken. Please choose another one.`);
      usernameInput.value = "";
      usernameInput.focus();
    }
  });
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
    socket.emit("chat-message", message);
    displayMessage(message, "sent");
    messageInput.value = "";
    messageInput.focus();
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

// Listen for username taken event
socket.on("username-taken", (data) => {
  alert(`Username "${data.username}" is already taken. Please choose another one.`);
  // Reset to username selection screen
  chatContainer.style.display = "none";
  usernameContainer.style.display = "block";
  usernameInput.value = "";
  usernameInput.focus();
});

// Listen for chat history when joining
socket.on("chat-history", (messages) => {
  console.log('Received chat history:', messages.length, 'messages');
  
  // Display all historical messages
  messages.forEach(data => {
    // Check if it's a system message
    if (data.isSystem || data.senderId === 'system') {
      displayMessage(data.message, "system", null, true);
    }
    // Check if this was our message
    else if (data.username === currentUsername) {
      displayMessage(data.message, "sent");
    } else {
      displayMessage(data.message, "received", data.username);
    }
  });
});

// Listen for incoming messages from the server
socket.on("chat-message", (data) => {
  // Check if the message is from the current user
  if (data.senderId === socket.id) {
    return; // Don't display our own message again
  }
  
  // Display messages from other users as received
  displayMessage(data.message, "received", data.username);
});

// Listen for user joined event
socket.on("user-joined", (data) => {
  displayMessage(`${data.username} joined the chat`, "system", null, true);
  updateOnlineUsers(data.onlineUsers);
});

// Listen for user left event
socket.on("user-left", (data) => {
  displayMessage(`${data.username} left the chat`, "system", null, true);
  updateOnlineUsers(data.onlineUsers);
});