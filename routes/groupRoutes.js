const express = require('express');
const router = express.Router();
const GroupChat = require('../models/GroupChat');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');

// 👥 CREATE A NEW GROUP CHAT
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { name, members } = req.body;
    
    // Automatically include the creator in the members list
    const allMembers = [...new Set([...members, req.user.id])];
    
    const newGroup = new GroupChat({
      name,
      adminId: req.user.id,
      members: allMembers
    });
    
    await newGroup.save();
    res.status(201).json(newGroup);
  } catch (err) { 
    res.status(500).json({ message: "Failed to create group." }); 
  }
});

// 📚 GET ALL GROUPS THE USER IS A PART OF
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Find groups where this user is in the members array, and grab the member usernames
    const groups = await GroupChat.find({ members: req.user.id }).populate('members', 'username');
    res.status(200).json(groups);
  } catch (err) { 
    res.status(500).json({ message: "Failed to fetch groups." }); 
  }
});

// 📥 GET MESSAGES FOR A SPECIFIC GROUP
router.get('/:groupId/messages', authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({ groupId: req.params.groupId }).sort({ createdAt: 1 });
    res.status(200).json(messages);
  } catch (err) { 
    res.status(500).json({ message: "Failed to fetch messages." }); 
  }
});

// 📤 SEND A MESSAGE TO A GROUP
router.post('/:groupId/message', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    const newMessage = new Message({
      senderId: req.user.id,
      groupId: req.params.groupId,
      text
    });
    
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (err) { 
    res.status(500).json({ message: "Failed to send message." }); 
  }
});

module.exports = router;