const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User'); 

// ==========================================
// 📝 PUBLISH A NEW ARTICLE TO MONGODB
// ==========================================
// 📝 PUBLISH A NEW ARTICLE TO MONGODB
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    
    const plainText = content.replace(/<[^>]+>/g, '');
    const snippet = plainText.substring(0, 150) + '...';

    // 🔥 FIX: Look up the actual user to get their username!
    const user = await User.findById(req.user.id);

    const newArticle = new Article({
      title,
      content,
      snippet,
      authorId: user._id,
      authorName: user.username, // No more Unknown Scholar!
      tags 
    });

    await newArticle.save();
    res.status(201).json({ message: "Manuscript published successfully!", article: newArticle });
  } catch (error) {
    console.error("Publishing error:", error);
    res.status(500).json({ message: "Failed to publish manuscript." });
  }
});

// ==========================================
// 📰 GET ARCHIVES FEED (100% Dynamic, Hides Private Works)
// ==========================================
router.get('/feed', async (req, res) => {
  try {
    const requestedCategory = req.query.category || 'all';
    let articles;

    if (requestedCategory === 'all') {
      // 🔥 Fetch the 20 newest articles, ONLY if they are NOT private
      articles = await Article.find({ isPrivate: false }).sort({ createdAt: -1 }).limit(20);
    } else {
      // 🔥 Fetch by category, ONLY if they are NOT private
      articles = await Article.find({ 
        isPrivate: false,
        tags: { $regex: new RegExp(requestedCategory, 'i') } 
      }).sort({ createdAt: -1 }).limit(20);
    }

    res.status(200).json(articles);

  } catch (error) {
    console.error("Backend Error Fetching Articles:", error);
    res.status(500).json({ message: "The librarian dropped the archives." });
  }
});
// 🌐 GET NETWORK FEED (Articles from followed scholars)
router.get('/network', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Fetch public articles where the author ID is in the user's "following" array!
    const networkArticles = await Article.find({ 
      authorId: { $in: user.following }, 
      isPrivate: false 
    }).sort({ createdAt: -1 }).limit(20);

    res.status(200).json(networkArticles);
  } catch (error) {
    console.error("Network Feed Error:", error);
    res.status(500).json({ message: "Failed to fetch network feed." });
  }
});

// ==========================================
// 📂 GET USER'S OWN ARTICLES
// ==========================================
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const articles = await Article.find({ authorId: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json(articles);
  } catch (err) {
    res.status(500).json({ message: "Error fetching your works." });
  }
});

// ==========================================
// 🗑️ DELETE AN ARTICLE
// ==========================================
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Article.findOneAndDelete({ _id: req.params.id, authorId: req.user.id });
    res.status(200).json({ message: "Manuscript burned." });
  } catch (err) {
    res.status(500).json({ message: "Error deleting manuscript." });
  }
});

// ==========================================
// 🔒 TOGGLE ARTICLE PRIVACY
// ==========================================
router.patch('/:id/privacy', authMiddleware, async (req, res) => {
  try {
    const article = await Article.findOne({ _id: req.params.id, authorId: req.user.id });
    if (!article) return res.status(404).json({ message: "Article not found." });
    
    article.isPrivate = !article.isPrivate;
    await article.save();
    res.status(200).json(article);
  } catch (err) {
    res.status(500).json({ message: "Error updating privacy." });
  }
});

// ==========================================
// ✍️ EDIT AN EXISTING ARTICLE
// ==========================================
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    
    const plainText = content.replace(/<[^>]+>/g, '');
    const snippet = plainText.substring(0, 150) + '...';

    // Find the article by ID AND make sure the person editing it is the author
    const updatedArticle = await Article.findOneAndUpdate(
      { _id: req.params.id, authorId: req.user.id },
      { title, content, snippet, tags },
    { returnDocument: 'after' } // This tells MongoDB to return the newly updated version
    );

    if (!updatedArticle) return res.status(404).json({ message: "Manuscript not found or unauthorized." });
    
    res.status(200).json(updatedArticle);
  } catch (err) {
    console.error("Edit error:", err);
    res.status(500).json({ message: "Error updating manuscript." });
  }
});

// ==========================================
// 📖 GET A SINGLE ARTICLE BY ID
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ message: "Manuscript not found in the archives." });
    
    res.status(200).json(article);
  } catch (error) {
    console.error("Error fetching article:", error);
    res.status(500).json({ message: "The librarian could not unroll this scroll." });
  }
});

module.exports = router;