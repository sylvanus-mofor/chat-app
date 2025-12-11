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
let currentSessionToken = "";
let typingUsers = new Set();
let typingTimeout = null;
let typingAnimationInterval = null;
let dotCount = 1;

// Function to update typing indicator
function updateTypingIndicator() {
  const typingIndicator = document.getElementById("typing-indicator");
  
  if (typingUsers.size > 0) {
    const usersArray = Array.from(typingUsers);
    let text = "";
    
    if (usersArray.length === 1) {
      text = `${usersArray[0]} is typing`;
    } else if (usersArray.length === 2) {
      text = `${usersArray[0]} and ${usersArray[1]} are typing`;
    } else {
      text = `${usersArray.length} people are typing`;
    }
    
    // Start animation if not already running
    if (!typingAnimationInterval) {
      typingAnimationInterval = setInterval(() => {
        const dots = '.'.repeat(dotCount);
        typingIndicator.textContent = text + dots;
        dotCount = dotCount >= 5 ? 1 : dotCount + 1;
      }, 400);
    }
    
    typingIndicator.style.display = "block";
  } else {
    typingIndicator.style.display = "none";
    if (typingAnimationInterval) {
      clearInterval(typingAnimationInterval);
      typingAnimationInterval = null;
      dotCount = 1;
    }
  }
}

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
  const userCount = users.length;
  onlineUsersDiv.innerHTML = `
    <h3>
      Online Users
      <span id="user-count" class="user-count">${userCount}</span>
    </h3>
  `;
  
  // Add logout button to the header
  const chatHeader = document.querySelector('.chat-header');
  if (!document.getElementById('logout-btn')) {
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logout-btn';
    logoutBtn.className = 'logout-btn';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', logout);
    chatHeader.appendChild(logoutBtn);
  }
  
  users.forEach(user => {
    const userEl = document.createElement("div");
    userEl.classList.add("online-user");
    
    // Highlight current user
    if (user === currentUsername) {
      userEl.classList.add('current-user');
      userEl.innerHTML = `${user} <span class="you-badge">(You)</span>`;
    } else {
      userEl.textContent = user;
    }
    
    onlineUsersDiv.appendChild(userEl);
  });
}

// Check for existing session on page load
window.addEventListener('DOMContentLoaded', () => {
  currentSessionToken = localStorage.getItem('chatSessionToken');
  
  if (currentSessionToken) {
    // Show loading indicator
    const joinBtn = document.getElementById('join-btn');
    const originalText = joinBtn.textContent;
    joinBtn.textContent = 'Restoring session...';
    joinBtn.disabled = true;
    
    // Try to restore session
    socket.emit("restore-session", currentSessionToken, (response) => {
      if (response.success) {
        currentUsername = response.username;
        usernameContainer.style.display = "none";
        chatContainer.style.display = "flex";
        messageInput.focus();
        
        // Display chat history
        response.messages.forEach(data => {
          if (data.isSystem || data.senderId === 'system') {
            displayMessage(data.message, "system", null, true);
          } else if (data.username === currentUsername) {
            displayMessage(data.message, "sent");
          } else {
            displayMessage(data.message, "received", data.username);
          }
        });
        
        // Update online users
        updateOnlineUsers(response.onlineUsers);
        
        console.log('Session restored successfully');
      } else {
        // Invalid session, clear it
        localStorage.removeItem('chatSessionToken');
        currentSessionToken = "";
        alert('Your session has expired. Please log in again.');
      }
      
      // Restore button state
      joinBtn.textContent = originalText;
      joinBtn.disabled = false;
    });
  }
});

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
      socket.emit("join", username, (joinResponse) => {
        if (joinResponse.success) {
          currentUsername = username;
          currentSessionToken = joinResponse.sessionToken;
          
          // Store session token in localStorage
          localStorage.setItem('chatSessionToken', currentSessionToken);
          
          usernameContainer.style.display = "none";
          chatContainer.style.display = "flex";
          messageInput.focus();
          
          // Display chat history
          joinResponse.messages.forEach(data => {
            if (data.isSystem || data.senderId === 'system') {
              displayMessage(data.message, "system", null, true);
            } else if (data.username === currentUsername) {
              displayMessage(data.message, "sent");
            } else {
              displayMessage(data.message, "received", data.username);
            }
          });
          
          // Update online users
          updateOnlineUsers(joinResponse.onlineUsers);
        }
      });
    } else {
      alert(`Username "${username}" is already taken. Please choose another one.`);
      usernameInput.value = "";
      usernameInput.focus();
    }
  });
}

// Logout function
function logout() {
  if (confirm('Are you sure you want to logout?')) {
    if (currentSessionToken) {
      socket.emit("logout", currentSessionToken);
    }
    
    // Clear local storage
    localStorage.removeItem('chatSessionToken');
    currentSessionToken = "";
    currentUsername = "";
    
    // Reset UI
    chatContainer.style.display = "none";
    usernameContainer.style.display = "block";
    usernameInput.value = "";
    usernameInput.focus();
    messagesDiv.innerHTML = "";
    onlineUsersDiv.innerHTML = '<h3>Online Users</h3>';
    
    // Remove logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.remove();
    }
    
    // Disconnect and reconnect socket to clear server state
    socket.disconnect();
    socket.connect();
    
    console.log('User logged out successfully');
  }
}

// Listen for logout success from server
socket.on("logout-success", () => {
  console.log('Server confirmed logout');
});

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
    
    // Stop typing indicator when message is sent
    socket.emit("typing", false);
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
  }
}

// Handle typing indicator
messageInput.addEventListener("input", () => {
  if (currentUsername) {
    socket.emit("typing", true);
    
    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    // Set timeout to stop typing indicator after 2 seconds of inactivity
    typingTimeout = setTimeout(() => {
      socket.emit("typing", false);
    }, 2000);
  }
});

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

// Listen for typing events
socket.on("user-typing", (data) => {
  if (data.isTyping) {
    typingUsers.add(data.username);
  } else {
    typingUsers.delete(data.username);
  }
  updateTypingIndicator();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  // We keep the session token in localStorage
  // It will expire on server after inactivity
});