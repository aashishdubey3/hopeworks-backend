const express = require('express');
const router = express.Router();
const Discussion = require('../models/Discussion');
const User = require('../models/User'); // 🔥 NEW: We need this to look up your username!
const authMiddleware = require('../middleware/auth');

// 🗣️ GET ALL DISCUSSIONS
router.get('/', async (req, res) => {
  try {
    const topics = await Discussion.find().sort({ createdAt: -1 });
    res.status(200).json(topics);
  } catch (error) {
    res.status(500).json({ message: "Failed to load the grand hall." });
  }
});

// 📢 START A NEW DISCUSSION
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { title, content } = req.body;
    
    // 🔥 FIX: Look up the user in the database to get their actual username
    const user = await User.findById(req.user.id); 

    const newTopic = new Discussion({
      title,
      content,
      authorId: user._id,
      authorName: user.username // Now this won't be blank!
    });

    await newTopic.save();
    res.status(201).json(newTopic);
  } catch (error) {
    console.error("Topic Creation Error:", error);
    res.status(500).json({ message: "Failed to start discussion." });
  }
});

// 💬 ADD A REPLY TO A DISCUSSION
router.post('/:id/reply', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    const topic = await Discussion.findById(req.params.id);
    
    // 🔥 FIX: Look up the user for the reply as well
    const user = await User.findById(req.user.id); 
    
    if (!topic) return res.status(404).json({ message: "Topic not found." });

    topic.replies.push({
      text,
      authorName: user.username,
      authorId: user._id
    });

    await topic.save();
    res.status(200).json(topic);
  } catch (error) {
    console.error("Reply Error:", error);
    res.status(500).json({ message: "Failed to post reply." });
  }
});

module.exports = router;