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

// --- 1. Setup Dedicated Redis Clients ---
const publisherClient = redis.createClient({ url: "redis://redis:6379" });
publisherClient.on('error', (err) => console.log('Redis Publisher Error', err)); 
publisherClient.on('ready', () => console.log('Redis Publisher connected successfully!'));

const subscriberClient = redis.createClient({ url: "redis://redis:6379" }); 
subscriberClient.on('error', (err) => console.log('Redis Subscriber Error', err));
subscriberClient.on('ready', () => console.log('Redis Subscriber connected successfully!'));

// --- 2. Asynchronous Setup & Server Start ---
(async () => {
    try {
        await publisherClient.connect();
        await subscriberClient.connect();
        
        // Subscribe to the chat channel
        await subscriberClient.subscribe("chat-messages", (data, channel) => {
            if (channel === "chat-messages") {
                const parsedData = JSON.parse(data);
                console.log('Received from Redis:', parsedData); 
                
                // FIX: Broadcast to ALL clients in the room
                // The sender will filter out their own message on the client side if needed
                io.to(parsedData.room).emit("chat-message", {
                    senderId: parsedData.senderId, // Include senderId so client can identify their own messages
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

// --- 3. Socket.IO Handlers ---
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    
    // Join the default room
    socket.join("general");
    
    // Handle user joining with a username
    socket.on("join", (username) => {
        const user = username || `User${Math.floor(Math.random() * 1000)}`;
        onlineUsers.set(socket.id, user);
        socket.username = user;
        
        console.log(`${user} joined the chat`);
        
        // Notify all clients about the new user and updated user list
        io.emit("user-joined", {
            username: user,
            onlineUsers: Array.from(onlineUsers.values())
        });
    });
    
    // Listen for incoming messages from clients
    socket.on("chat-message", (msg) => {
        const username = socket.username || "Anonymous";
        console.log(`Message from ${username}:`, msg);
        
        // Publish message to Redis with metadata
        const messageData = {
            senderId: socket.id,
            username: username,
            message: msg,
            room: "general", // Using a default room, can be extended for multiple rooms
            timestamp: Date.now()
        };
        
        publisherClient.publish("chat-messages", JSON.stringify(messageData));
    });
    
    socket.on("disconnect", () => {
        const username = onlineUsers.get(socket.id);
        if (username) {
            console.log(`${username} disconnected`);
            onlineUsers.delete(socket.id);
            
            // Notify all clients about user leaving
            io.emit("user-left", {
                username: username,
                onlineUsers: Array.from(onlineUsers.values())
            });
        }
    });
});

// Serve static files
app.use(express.static("frontend"));