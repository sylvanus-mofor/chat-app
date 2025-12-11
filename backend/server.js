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
const SESSIONS_KEY = "chat:sessions"; // Hash: sessionToken -> userData
const MAX_MESSAGES = 1000;
const SESSION_EXPIRY = 86400; // 24 hours in seconds
const INACTIVITY_LIMIT = 3600000; // 1 hour in milliseconds

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

// --- 2. Helper Functions for Session Management ---
async function createSession(username, socketId, ipAddress) {
    try {
        const crypto = require('crypto');
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionData = {
            username: username,
            socketId: socketId,
            ipAddress: ipAddress,
            createdAt: Date.now(),
            lastActive: Date.now(),
            userAgent: null // Could store browser info if needed
        };
        
        // Store session in Redis with expiry
        await storageClient.hSet(SESSIONS_KEY, sessionToken, JSON.stringify(sessionData));
        await storageClient.expire(SESSIONS_KEY, SESSION_EXPIRY);
        
        console.log(`Session created for ${username} from IP ${ipAddress}`);
        return sessionToken;
    } catch (error) {
        console.error('Error creating session:', error);
        return null;
    }
}

async function validateSession(sessionToken) {
    try {
        const sessionData = await storageClient.hGet(SESSIONS_KEY, sessionToken);
        if (!sessionData) return null;
        
        const parsedData = JSON.parse(sessionData);
        
        // Check if session is expired (inactive for too long)
        if (Date.now() - parsedData.lastActive > INACTIVITY_LIMIT) {
            await storageClient.hDel(SESSIONS_KEY, sessionToken);
            return null;
        }
        
        // Update last active time
        parsedData.lastActive = Date.now();
        await storageClient.hSet(SESSIONS_KEY, sessionToken, JSON.stringify(parsedData));
        
        return parsedData;
    } catch (error) {
        console.error('Error validating session:', error);
        return null;
    }
}

async function removeSession(sessionToken) {
    try {
        const sessionData = await storageClient.hGet(SESSIONS_KEY, sessionToken);
        if (sessionData) {
            const parsedData = JSON.parse(sessionData);
            console.log(`Session removed for ${parsedData.username} from IP ${parsedData.ipAddress}`);
        }
        await storageClient.hDel(SESSIONS_KEY, sessionToken);
    } catch (error) {
        console.error('Error removing session:', error);
    }
}

async function getUserSessions(username) {
    try {
        const allSessions = await storageClient.hGetAll(SESSIONS_KEY);
        const userSessions = [];
        
        for (const [token, data] of Object.entries(allSessions)) {
            const sessionData = JSON.parse(data);
            if (sessionData.username === username) {
                userSessions.push({
                    token: token,
                    ...sessionData
                });
            }
        }
        
        return userSessions;
    } catch (error) {
        console.error('Error getting user sessions:', error);
        return [];
    }
}

// --- 3. Session Cleanup Task ---
async function cleanupExpiredSessions() {
    try {
        const allSessions = await storageClient.hGetAll(SESSIONS_KEY);
        let cleanedCount = 0;
        
        for (const [token, data] of Object.entries(allSessions)) {
            try {
                const sessionData = JSON.parse(data);
                const now = Date.now();
                
                // Remove sessions inactive for more than 1 hour
                if (now - sessionData.lastActive > INACTIVITY_LIMIT) {
                    await storageClient.hDel(SESSIONS_KEY, token);
                    
                    // Also remove from active users if no other sessions exist
                    const userSessions = await getUserSessions(sessionData.username);
                    if (userSessions.length === 0) {
                        await storageClient.sRem(USERS_KEY, sessionData.username);
                        console.log(`Removed ${sessionData.username} from active users (session expired)`);
                    }
                    
                    cleanedCount++;
                }
            } catch (error) {
                console.error('Error processing session:', error);
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`Cleaned ${cleanedCount} expired sessions`);
        }
    } catch (error) {
        console.error('Error cleaning sessions:', error);
    }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 300000);

// --- 4. Helper Functions for Message Persistence ---
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

// --- 5. Asynchronous Setup & Server Start ---
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
        
        // Initial session cleanup
        await cleanupExpiredSessions();
        
        // Start the HTTP/Socket.IO server
        const PORT = process.env.PORT || 5000;
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Fatal Error during Redis Connection or Setup:", error);
    }
})();

// --- 6. Socket.IO Handlers ---
io.on("connection", (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || 
                    socket.handshake.address || 
                    socket.request.connection.remoteAddress;
    
    console.log("A user connected:", socket.id, "IP:", clientIp);
    
    // Join the default room
    socket.join("general");
    
    // Check for existing session token
    socket.on("restore-session", async (sessionToken, callback) => {
        const sessionData = await validateSession(sessionToken);
        
        if (sessionData) {
            // Update socket ID and IP in session
            sessionData.socketId = socket.id;
            sessionData.lastActive = Date.now();
            sessionData.ipAddress = clientIp; // Update IP in case it changed
            
            await storageClient.hSet(SESSIONS_KEY, sessionToken, JSON.stringify(sessionData));
            
            // Restore user session
            onlineUsers.set(socket.id, sessionData.username);
            socket.username = sessionData.username;
            socket.sessionToken = sessionToken;
            
            // Get chat history
            const recentMessages = await getRecentMessages();
            
            // Get all active usernames
            const activeUsernames = await getActiveUsernames();
            
            callback({
                success: true,
                username: sessionData.username,
                messages: recentMessages,
                onlineUsers: activeUsernames
            });
            
            console.log(`${sessionData.username} restored session from IP ${clientIp}`);
        } else {
            callback({ success: false });
        }
    });
    
    // Handle username availability check
    socket.on("check-username", async (username, callback) => {
        const available = await isUsernameAvailable(username);
        callback({ available });
    });
    
    // Handle user joining with a username
    socket.on("join", async (username, callback) => {
        // Double-check username availability
        const available = await isUsernameAvailable(username);
        
        if (!available) {
            socket.emit("username-taken", { username });
            if (callback) callback({ success: false });
            return;
        }
        
        const user = username || `User${Math.floor(Math.random() * 1000)}`;
        onlineUsers.set(socket.id, user);
        socket.username = user;
        
        // Add username to Redis set
        await addUsername(user);
        
        console.log(`${user} joined the chat from IP ${clientIp}`);
        
        // Create session
        const sessionToken = await createSession(user, socket.id, clientIp);
        socket.sessionToken = sessionToken;
        
        // Send chat history to the newly connected user
        const recentMessages = await getRecentMessages();
        
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
        
        if (callback) {
            callback({
                success: true,
                sessionToken: sessionToken,
                messages: recentMessages,
                onlineUsers: activeUsernames
            });
        }
    });
    
    // Handle user logout
    socket.on("logout", async (sessionToken) => {
        const username = onlineUsers.get(socket.id);
        
        if (username) {
            console.log(`${username} requested logout from IP ${clientIp}`);
            
            // Remove from online users
            onlineUsers.delete(socket.id);
            
            // Remove username from Redis set
            await removeUsername(username);
            
            // Remove all sessions for this user
            if (sessionToken) {
                await removeSession(sessionToken);
            }
            
            // Get updated active usernames
            const activeUsernames = await getActiveUsernames();
            await saveSystemMessage(`${username} logged out`);
            
            // Notify all clients about user leaving
            io.emit("user-left", {
                username: username,
                onlineUsers: activeUsernames
            });          
            socket.emit("logout-success");
        }
    });
    
    // Listen for typing events
    socket.on("typing", (isTyping) => {
        const username = socket.username;
        if (username) {
            socket.broadcast.emit("user-typing", {
                username: username,
                isTyping: isTyping
            });
        }
    });
    
    // Listen for incoming messages
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
        
        // Update session last active time
        if (socket.sessionToken) {
            try {
                const sessionData = await storageClient.hGet(SESSIONS_KEY, socket.sessionToken);
                if (sessionData) {
                    const parsedData = JSON.parse(sessionData);
                    parsedData.lastActive = Date.now();
                    await storageClient.hSet(SESSIONS_KEY, socket.sessionToken, JSON.stringify(parsedData));
                }
            } catch (error) {
                console.error('Error updating session activity:', error);
            }
        }
    });
    
    // Handle disconnect
    socket.on("disconnect", async () => {
        const username = onlineUsers.get(socket.id);
        if (username) {
            console.log(`${username} disconnected from IP ${clientIp}`);
            onlineUsers.delete(socket.id);
            
            // Don't remove from Redis set or session yet
            // Wait for session expiry or explicit logout
            // Get current active users (user might still have active sessions)
            const activeUsernames = await getActiveUsernames();
            
            // Only send leave message if user has no other active sessions
            const userSessions = await getUserSessions(username);
            const hasOtherActiveSessions = userSessions.some(session => 
                session.socketId !== socket.id
            );
            
            if (!hasOtherActiveSessions) {
                // Save system message about user leaving
                const leaveMessage = `${username} left the chat`;
                await saveSystemMessage(leaveMessage);
                
                // Notify all clients about user leaving
                io.emit("user-left", {
                    username: username,
                    onlineUsers: activeUsernames
                });
            }
        }
    });
});

// Serve static files
app.use(express.static("frontend"));