const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');

// 🗂️ GET ALL INBOX CONTACTS & REQUESTS
router.get('/inbox/contacts', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const User = require('../models/User');

    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }]
    }).sort({ createdAt: -1 });

    const chatUserIds = [...new Set(messages.map(m => 
      m.senderId.toString() === userId ? m.receiverId.toString() : m.senderId.toString()
    ))];

    const currentUser = await User.findById(userId);
    const allContactIds = [...new Set([...chatUserIds, ...currentUser.following.map(id => id.toString())])];
    
    // 🔥 FIX: Filter out our own ID so we don't show up in our own inbox!
    const filteredIds = allContactIds.filter(id => id !== userId);

    const contacts = await User.find({ _id: { $in: filteredIds } }).select('username _id');

    res.status(200).json({ contacts, following: currentUser.following, blockedUsers: currentUser.blockedUsers });
  } catch (error) {
    res.status(500).json({ message: "Failed to load inbox." });
  }
});

// 📥 GET CHAT HISTORY WITH A SPECIFIC SCHOLAR
router.get('/:otherUserId', authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { senderId: req.user.id, receiverId: req.params.otherUserId },
        { senderId: req.params.otherUserId, receiverId: req.user.id }
      ]
    }).sort({ createdAt: 1 }); 
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: "Failed to load messages." });
  }
});

// 📤 SEND A NEW PRIVATE MESSAGE
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { receiverId, text } = req.body;
    
    // 🔥 GUARDRAIL: Check if either user has blocked the other!
    const User = require('../models/User');
    const sender = await User.findById(req.user.id);
    const receiver = await User.findById(receiverId);

    if (sender.blockedUsers.includes(receiverId) || receiver.blockedUsers.includes(req.user.id)) {
      return res.status(403).json({ message: "Transmission blocked by user privacy settings." });
    }

    const newMessage = new Message({ senderId: req.user.id, receiverId, text });
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ message: "Failed to send message." });
  }
});

// 🗑️ DELETE A PRIVATE CHAT
router.delete('/:otherUserId', authMiddleware, async (req, res) => {
  try {
    await Message.deleteMany({
      $or: [
        { senderId: req.user.id, receiverId: req.params.otherUserId },
        { senderId: req.params.otherUserId, receiverId: req.user.id }
      ]
    });
    res.status(200).json({ message: "Chat logs burned." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete chat." });
  }
});

module.exports = router;