const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const redis = require("redis");
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Track online users (in-memory, per instance)
const onlineUsers = new Map(); // Map of socketId -> username

// Redis keys
const MESSAGES_KEY = "chat:messages";
const USERS_KEY = "chat:users"; // Set to track active usernames
const MAX_MESSAGES = 1000;

// --- 1. Setup Dedicated Redis Clients ---
const publisherClient = redis.createClient({ url: "redis://redis:6379" });
publisherClient.on('error', (err) => console.log('Redis Publisher Error', err)); 
publisherClient.on('ready', () => console.log('Redis Publisher connected successfully!'));

const subscriberClient = redis.createClient({ url: "redis://redis:6379" }); 
subscriberClient.on('error', (err) => console.log('Redis Subscriber Error', err));
subscriberClient.on('ready', () => console.log('Redis Subscriber connected successfully!'));

// Storage client for getting/setting messages
const storageClient = redis.createClient({ url: "redis://redis:6379" });
storageClient.on('error', (err) => console.log('Redis Storage Error', err));
storageClient.on('ready', () => console.log('Redis Storage connected successfully!'));

// --- 2. Asynchronous Setup & Server Start ---
(async () => {
    try {
        await publisherClient.connect();
        await subscriberClient.connect();
        await storageClient.connect();
        
        // Subscribe to the chat channel
        await subscriberClient.subscribe("chat-messages", (data, channel) => {
            if (channel === "chat-messages") {
                const parsedData = JSON.parse(data);
                console.log('Received from Redis:', parsedData); 
                
                // Broadcast to ALL clients in the room
                io.to(parsedData.room).emit("chat-message", {
                    senderId: parsedData.senderId,
                    username: parsedData.username,
                    message: parsedData.message,
                    timestamp: parsedData.timestamp
                });
            }
        });
        
        // Start the HTTP/Socket.IO server
        const PORT = process.env.PORT || 5000;
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Fatal Error during Redis Connection or Setup:", error);
    }
})();

// --- 3. Helper Functions for Message Persistence ---
async function saveMessage(messageData) {
    try {
        // Add message to the end of the list
        await storageClient.rPush(MESSAGES_KEY, JSON.stringify(messageData));
        
        // Trim the list to keep only the last MAX_MESSAGES
        await storageClient.lTrim(MESSAGES_KEY, -MAX_MESSAGES, -1);
        
        console.log('Message saved to Redis');
    } catch (error) {
        console.error('Error saving message:', error);
    }
}

async function saveSystemMessage(message) {
    try {
        const systemMessage = {
            senderId: 'system',
            username: 'System',
            message: message,
            room: 'general',
            timestamp: Date.now(),
            isSystem: true
        };
        
        await storageClient.rPush(MESSAGES_KEY, JSON.stringify(systemMessage));
        await storageClient.lTrim(MESSAGES_KEY, -MAX_MESSAGES, -1);
        
        console.log('System message saved to Redis');
    } catch (error) {
        console.error('Error saving system message:', error);
    }
}

async function getRecentMessages() {
    try {
        // Get all messages (up to MAX_MESSAGES due to trim)
        const messages = await storageClient.lRange(MESSAGES_KEY, 0, -1);
        return messages.map(msg => JSON.parse(msg));
    } catch (error) {
        console.error('Error retrieving messages:', error);
        return [];
    }
}

async function isUsernameAvailable(username) {
    try {
        const exists = await storageClient.sIsMember(USERS_KEY, username);
        return !exists;
    } catch (error) {
        console.error('Error checking username:', error);
        return false;
    }
}

async function addUsername(username) {
    try {
        await storageClient.sAdd(USERS_KEY, username);
    } catch (error) {
        console.error('Error adding username:', error);
    }
}

async function removeUsername(username) {
    try {
        await storageClient.sRem(USERS_KEY, username);
    } catch (error) {
        console.error('Error removing username:', error);
    }
}

async function getActiveUsernames() {
    try {
        return await storageClient.sMembers(USERS_KEY);
    } catch (error) {
        console.error('Error getting active usernames:', error);
        return [];
    }
}

// --- 4. Socket.IO Handlers ---
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    
    // Join the default room
    socket.join("general");
    
    // Handle username availability check
    socket.on("check-username", async (username, callback) => {
        const available = await isUsernameAvailable(username);
        callback({ available });
    });
    
    // Handle user joining with a username
    socket.on("join", async (username) => {
        // Double-check username availability
        const available = await isUsernameAvailable(username);
        
        if (!available) {
            socket.emit("username-taken", { username });
            return;
        }
        
        const user = username || `User${Math.floor(Math.random() * 1000)}`;
        onlineUsers.set(socket.id, user);
        socket.username = user;
        
        // Add username to Redis set
        await addUsername(user);
        
        console.log(`${user} joined the chat`);
        
        // Send chat history to the newly connected user
        const recentMessages = await getRecentMessages();
        socket.emit("chat-history", recentMessages);
        
        // Get all active usernames
        const activeUsernames = await getActiveUsernames();
        
        // Save system message about user joining
        const joinMessage = `${user} joined the chat`;
        await saveSystemMessage(joinMessage);
        
        // Notify all clients about the new user and updated user list
        io.emit("user-joined", {
            username: user,
            onlineUsers: activeUsernames
        });
    });
    
    // Listen for incoming messages from clients
    socket.on("chat-message", async (msg) => {
        const username = socket.username || "Anonymous";
        console.log(`Message from ${username}:`, msg);
        
        // Create message data object
        const messageData = {
            senderId: socket.id,
            username: username,
            message: msg,
            room: "general",
            timestamp: Date.now()
        };
        
        // Save message to Redis storage
        await saveMessage(messageData);
        
        // Publish message to Redis pub/sub
        publisherClient.publish("chat-messages", JSON.stringify(messageData));
    });
    
    socket.on("disconnect", async () => {
        const username = onlineUsers.get(socket.id);
        if (username) {
            console.log(`${username} disconnected`);
            onlineUsers.delete(socket.id);
            
            // Remove username from Redis set
            await removeUsername(username);
            
            // Get updated active usernames
            const activeUsernames = await getActiveUsernames();
            
            // Save system message about user leaving
            const leaveMessage = `${username} left the chat`;
            await saveSystemMessage(leaveMessage);
            
            // Notify all clients about user leaving
            io.emit("user-left", {
                username: username,
                onlineUsers: activeUsernames
            });
        }
    });
});

// Serve static files
app.use(express.static("frontend"));