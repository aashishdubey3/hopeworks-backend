const express = require('express');
const Media = require('../models/Media');
const User = require('../models/User');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// ==========================================
// 📚 SEARCH ROUTE (Google Books)
// ==========================================
router.get('/search/books', async (req, res) => {
  try {
    const { query } = req.query;
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5`);
    const data = await response.json();

    const cleanResults = data.items.map(item => ({
      externalId: item.id,
      title: item.volumeInfo.title,
      creator: item.volumeInfo.authors ? item.volumeInfo.authors.join(', ') : 'Unknown Author',
      blurb: item.volumeInfo.description || 'No summary available.',
      coverImage: item.volumeInfo.imageLinks ? item.volumeInfo.imageLinks.thumbnail : '',
      mediaType: 'book'
    }));

    res.status(200).json(cleanResults);
  } catch (error) {
    res.status(500).json({ message: 'Error searching the global book library.', error: error.message });
  }
});

// ==========================================
// 🎬 SEARCH ROUTE (TMDB for Movies & Series)
// ==========================================
router.get('/search/movies', async (req, res) => {
  try {
    const { query } = req.query;
    
    // We use TMDB's "multi" search so it looks for both movies and TV shows at the same time
    const url = `https://api.themoviedb.org/3/search/multi?query=${query}&api_key=${process.env.TMDB_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    // Clean up TMDB's data to perfectly match our Media database blueprint
    const cleanResults = data.results
      // Filter out actors/people, we only want movies and TV shows
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      // Only keep the top 5 results to match the books layout
      .slice(0, 5) 
      .map(item => ({
        externalId: item.id.toString(),
        // TMDB uses 'title' for movies and 'name' for TV series
        title: item.title || item.name, 
        creator: item.media_type === 'movie' ? 'Feature Film' : 'Television Series',
        blurb: item.overview || 'No summary available.',
        // TMDB only gives us half the image link, we have to add the base URL
        coverImage: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
        mediaType: item.media_type === 'tv' ? 'series' : 'movie'
      }));

    res.status(200).json(cleanResults);
  } catch (error) {
    res.status(500).json({ message: 'Error searching the global film database.', error: error.message });
  }
});

// ==========================================
// 💾 SAVE TO LIST ROUTE (Requires Login)
// ==========================================
router.post('/add-to-list', verifyToken, async (req, res) => {
  try {
    const { mediaData, listType } = req.body; 

    let mediaItem = await Media.findOne({ externalId: mediaData.externalId });
    
    if (!mediaItem) {
      mediaItem = new Media(mediaData);
      await mediaItem.save();
    }

    const user = await User.findById(req.user.userId);

    if (!user[listType].includes(mediaItem._id)) {
      user[listType].push(mediaItem._id);
      await user.save();
    }

    res.status(200).json({ message: `Successfully added to your ${listType}!` });
  } catch (error) {
    res.status(500).json({ message: 'Error adding to your list.', error: error.message });
  }
});

module.exports = router;