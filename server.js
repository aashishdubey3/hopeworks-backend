const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http'); 
const { Server } = require('socket.io'); 

require('dotenv').config();

// 📥 IMPORT ALL YOUR ROUTES HERE
const authRoutes = require('./routes/authRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const aiRoutes = require('./routes/aiRoutes');
const articleRoutes = require('./routes/articleRoutes');
const userRoutes = require('./routes/userRoutes');
const discussionRoutes = require('./routes/discussionRoutes'); 
const messageRoutes = require('./routes/messageRoutes');
const groupRoutes = require('./routes/groupRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const server = http.createServer(app); // 🔥 Wrap Express in HTTP server

// 🔥 Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL, 
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Apply Routes
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/discussions', discussionRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/notifications', notificationRoutes);

// ==========================================
// 📚 DATABASE CONNECTION (The IPv4 Fix)
// ==========================================
mongoose.connect(process.env.MONGO_URI, {
  family: 4, // 🔥 THIS FORCES NODE.JS TO BYPASS THE MONGODB ATLAS IPv6 BUG
})
  .then(() => console.log('📚 Connected to The Lantern Library Database (IPv4 Forced)'))
  .catch((err) => console.log('Database connection error:', err));


// Basic Test Route
app.get('/', (req, res) => {
  res.send('The Lantern Library API is running...');
});

// 🔥 TRACK WHO IS CURRENTLY ONLINE
const onlineScholars = new Map();

io.on('connection', (socket) => {
  console.log('A scholar connected:', socket.id);

  // 1. When a user logs in, they silently register their ID with the server
  socket.on('register_scholar', (userId) => {
    onlineScholars.set(userId, socket.id);
  });

  // 🔥 NEW: REAL-TIME ONLINE STATUS CHECK
  socket.on('check_online_status', (targetUserId) => {
    const isOnline = onlineScholars.has(targetUserId);
    // Send the true status back to the person who asked!
    socket.emit('online_status_result', { userId: targetUserId, isOnline });
  });

  // 2. Group Lounge (Community.jsx)
  socket.on('join_topic', (topicId) => {
    socket.join(topicId);
  });
  socket.on('send_reply', (data) => {
    socket.to(data.topicId).emit('receive_reply', data.replyData);
  });

  // 3. PRIVATE DIRECT MESSAGING
  socket.on('send_private_message', (data) => {
    // data contains { receiverId, message }
    const receiverSocketId = onlineScholars.get(data.receiverId);
    
    // If the person is currently online, send it straight to their screen!
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receive_private_message', data.message);
    }
  });

  // 4. GROUP CHAT MESSAGING
  socket.on('join_group_chat', (groupId) => {
    socket.join(groupId); // Joins a specific group room
  });

  socket.on('send_group_message', (data) => {
    // data contains { groupId, message }
    // Broadcasts to everyone in that specific group room EXCEPT the sender
    socket.to(data.groupId).emit('receive_group_message', data.message);
  });

  // 5. LIVE NOTIFICATION PING
  socket.on('send_notification_ping', (data) => {
    // data contains { targetUserId, alertMessage }
    const targetSocketId = onlineScholars.get(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('receive_notification_ping', data);
    }
  });

  // 6. When they close the browser
  socket.on('disconnect', () => {
    // Find and remove them from the online list
    for (let [userId, socketId] of onlineScholars.entries()) {
      if (socketId === socket.id) {
        onlineScholars.delete(userId);
        break;
      }
    }
  });
});

// 🔥 IMPORTANT: Use server.listen instead of app.listen!
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server & Live Sockets are glowing on port ${PORT}`);
});