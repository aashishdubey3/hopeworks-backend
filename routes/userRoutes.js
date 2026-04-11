const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Article = require('../models/Article');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const GroupChat = require('../models/GroupChat');
const authMiddleware = require('../middleware/auth');

// 👤 GET CURRENT USER PROFILE
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ⚙️ UPDATE USER PROFILE & SETTINGS (Includes Privacy Toggle)
router.put('/update', authMiddleware, async (req, res) => {
  try {
    const { username, bio, interests, dailyArticleGoal, isLibraryPublic } = req.body;
    const user = await User.findById(req.user.id);
    
    if (username) user.username = username;
    if (bio) user.bio = bio;
    if (interests) user.interests = interests;
    if (dailyArticleGoal) user.dailyArticleGoal = dailyArticleGoal;
    if (isLibraryPublic !== undefined) user.isLibraryPublic = isLibraryPublic;
    
    await user.save();
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// 🔍 GET PUBLIC SCHOLAR PROFILE & THEIR MANUSCRIPTS
router.get('/scholar/:id', async (req, res) => {
  try {
    const scholar = await User.findById(req.params.id).select('-password -email'); 
    if (!scholar) return res.status(404).json({ message: "Scholar not found." });
    
    // Fetch ONLY their public manuscripts
    const publicArticles = await Article.find({ authorId: req.params.id, isPrivate: false }).sort({ createdAt: -1 });

    res.status(200).json({ scholar, publicArticles });
  } catch (err) {
    res.status(500).json({ message: "Error retrieving archives." });
  }
});

// 🔎 GET: Search for scholars by username
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(200).json([]);

    // Use a case-insensitive regex to find partial matches
    // $ne (Not Equal) ensures you don't see yourself in the search results
    const scholars = await User.find({
      username: { $regex: query, $options: 'i' },
      _id: { $ne: req.user.id } 
    })
    .select('username bio followers') // Only grab safe, public info
    .limit(10); // Limit to 10 results to keep the database fast

    res.status(200).json(scholars);
  } catch (err) {
    console.error("Search Error:", err);
    res.status(500).json({ message: "Error searching the archives." });
  }
});

// ➕ FOLLOW / UNFOLLOW A SCHOLAR
router.post('/follow/:id', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(req.params.id);

    if (!targetUser) return res.status(404).json({ message: "Scholar not found." });

    let isFollowing = false;

    if (currentUser.following.includes(req.params.id)) {
      // Unfollow
      currentUser.following = currentUser.following.filter(id => id.toString() !== req.params.id);
      targetUser.followers = targetUser.followers.filter(id => id.toString() !== req.user.id);
    } else {
      // Follow
      currentUser.following.push(req.params.id);
      targetUser.followers.push(req.user.id);
      isFollowing = true;
    }

    await currentUser.save();
    await targetUser.save();

    res.status(200).json({ isFollowing, followingList: currentUser.following });
  } catch (err) {
    res.status(500).json({ message: "Error updating network." });
  }
});

// 🤝 SEND FRIEND REQUEST (With Notification Trigger)
router.post('/friend-request/:id', authMiddleware, async (req, res) => {
  try {
    // Prevent sending a request to yourself
    if (req.user.id === req.params.id) {
      return res.status(400).json({ message: "You cannot befriend yourself in the archives." });
    }

    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "Scholar not found." });

    if (!targetUser.friendRequests.includes(req.user.id) && !targetUser.friends.includes(req.user.id)) {
      targetUser.friendRequests.push(req.user.id);
      await targetUser.save();

      // Trigger the Notification!
      const newAlert = new Notification({
        recipientId: targetUser._id,
        senderId: currentUser._id,
        senderName: currentUser.username,
        type: 'friend_request',
        message: `${currentUser.username} sent you a friend request.`
      });
      await newAlert.save();
    }
    
    res.status(200).json({ message: "Request sent!" });
  } catch (err) { 
    res.status(500).json({ message: "Error sending request." }); 
  }
});

// ✅ ACCEPT FRIEND REQUEST
router.post('/accept-request/:id', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(req.params.id);

    // Remove from requests list
    currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== req.params.id);
    
    // Add to friends list for BOTH users
    if (!currentUser.friends.includes(req.params.id)) currentUser.friends.push(req.params.id);
    if (!targetUser.friends.includes(req.user.id)) targetUser.friends.push(req.user.id);

    await currentUser.save();
    await targetUser.save();
    
    res.status(200).json({ friends: currentUser.friends, friendRequests: currentUser.friendRequests });
  } catch (err) { 
    res.status(500).json({ message: "Error accepting request." }); 
  }
});

// ❌ DECLINE REQUEST / UNFRIEND
router.post('/remove-friend/:id', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(req.params.id);

    // Remove from all friend and request lists
    currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== req.params.id);
    currentUser.friends = currentUser.friends.filter(id => id.toString() !== req.params.id);
    
    if (targetUser) {
      targetUser.friends = targetUser.friends.filter(id => id.toString() !== req.user.id);
      await targetUser.save();
    }

    await currentUser.save();
    res.status(200).json({ friends: currentUser.friends, friendRequests: currentUser.friendRequests });
  } catch (err) { 
    res.status(500).json({ message: "Error updating network." }); 
  }
});

// 🚫 BLOCK / UNBLOCK A SCHOLAR
router.post('/block/:id', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const targetId = req.params.id;

    if (currentUser.blockedUsers.includes(targetId)) {
      // Unblock
      currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id.toString() !== targetId);
    } else {
      // Block! (Scrub them from absolutely everything)
      currentUser.blockedUsers.push(targetId);
      currentUser.following = currentUser.following.filter(id => id.toString() !== targetId);
      currentUser.followers = currentUser.followers.filter(id => id.toString() !== targetId);
      
      // Sever the Friendship and Requests
      currentUser.friends = currentUser.friends.filter(id => id.toString() !== targetId);
      currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== targetId);

      const targetUser = await User.findById(targetId);
      if (targetUser) {
        targetUser.following = targetUser.following.filter(id => id.toString() !== req.user.id);
        targetUser.followers = targetUser.followers.filter(id => id.toString() !== req.user.id);
        
        // Remove us from their Friends list too
        targetUser.friends = targetUser.friends.filter(id => id.toString() !== req.user.id);
        targetUser.friendRequests = targetUser.friendRequests.filter(id => id.toString() !== req.user.id);
        await targetUser.save();
      }
    }

    await currentUser.save();
    res.status(200).json({ blockedUsers: currentUser.blockedUsers });
  } catch (err) {
    res.status(500).json({ message: "Error updating block list." });
  }
});

// ==========================================
// 📚 MEDIA LIST MANAGEMENT
// ==========================================

// ➕ ADD ITEM TO LIBRARY
router.post('/add-item', authMiddleware, async (req, res) => {
  try {
    const { title, mediaType, coverImage, listType } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Scholar not found in the archives." });

    const newItem = {
      title,
      mediaType,
      coverImage: coverImage || 'https://placehold.co/150x220/2c3e50/ecf0f1?text=No+Cover',
      addedAt: new Date()
    };

    // Route it to the correct shelf (Defaults to To Be Read)
    if (listType === 'currentlyConsuming') {
      user.currentlyConsuming.push(newItem);
    } else if (listType === 'finishedList') {
      user.finishedList.push(newItem);
    } else {
      user.tbrList.push(newItem);
    }

    await user.save();
    res.status(200).json({ message: "Successfully added to archives!", user });

  } catch (error) {
    console.error("🔥 ADD ITEM CRASH:", error);
    res.status(500).json({ message: "Server error while adding item." });
  }
});

// 🚚 MOVE ITEM
router.post('/move-item', authMiddleware, async (req, res) => {
  try {
    const { mediaId, currentList, targetList } = req.body;
    const user = await User.findById(req.user.id);

    // Find the item in the current list
    const itemIndex = user[currentList].findIndex(item => item._id.toString() === mediaId);
    if (itemIndex === -1) return res.status(404).json({ message: 'Item not found in current list.' });

    // Extract the item and remove it from the old list
    const [itemToMove] = user[currentList].splice(itemIndex, 1);

    // Add it to the new list
    user[targetList].push(itemToMove);
    await user.save();

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error moving item' });
  }
});

// ⭐ ADD REVIEW (FIXED FOR MONGOOSE MAPS)
router.post('/add-review', authMiddleware, async (req, res) => {
  try {
    const { mediaId, rating, reviewText } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Safely initialize as a proper Mongoose Map if it doesn't exist
    if (!user.personalReviews || !(user.personalReviews instanceof Map)) {
      user.personalReviews = new Map(Object.entries(user.personalReviews || {}));
    }

    // Use the official .set() method so the database actually saves it!
    user.personalReviews.set(mediaId.toString(), { rating, reviewText, date: new Date() });
    
    await user.save();
    res.status(200).json(user);
  } catch (error) {
    console.error("Review Save Error:", error);
    res.status(500).json({ message: 'Error adding review' });
  }
});

// 🚨 PERMANENTLY DELETE ACCOUNT & ALL DATA
router.delete('/delete', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Burn all their published manuscripts
    await Article.deleteMany({ authorId: userId });
    
    // 2. Burn all their private messages (sent or received)
    await Message.deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] });

    // 3. Burn all notifications involving them
    await Notification.deleteMany({ $or: [{ recipientId: userId }, { senderId: userId }] });

    // 4. Remove them from any Group Chats they are in
    await GroupChat.updateMany({ members: userId }, { $pull: { members: userId } });

    // 5. Finally, delete the scholar
    await User.findByIdAndDelete(userId);

    res.status(200).json({ message: "Scholar erased from the archives." });
  } catch (err) {
    console.error("Deletion Error:", err);
    res.status(500).json({ message: "Failed to delete account." });
  }
});

module.exports = router;