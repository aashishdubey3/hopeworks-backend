const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const authMiddleware = require('../middleware/auth');

// 📥 GET ALL NOTIFICATIONS FOR CURRENT USER
router.get('/', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipientId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20); // Only keep the 20 most recent to keep it fast
    res.status(200).json(notifications);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch alerts." });
  }
});

// 👁️ MARK A SINGLE NOTIFICATION AS READ
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id, 
      { isRead: true }, 
      { returnDocument: 'after' }
    );
    res.status(200).json(notification);
  } catch (err) {
    res.status(500).json({ message: "Failed to update alert." });
  }
});

// ✅ MARK ALL AS READ
router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipientId: req.user.id, isRead: false }, 
      { isRead: true }
    );
    res.status(200).json({ message: "All caught up!" });
  } catch (err) {
    res.status(500).json({ message: "Failed to clear alerts." });
  }
});

module.exports = router;