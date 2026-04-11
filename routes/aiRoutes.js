const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// ==========================================
// ✨ SUMMON PROTAGONIST ROUTE
// ==========================================
router.post('/summon', verifyToken, async (req, res) => {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const { characterName, mediaTitle, userMessage, chatHistory } = req.body;

    const systemInstruction = `You are ${characterName} from the story/movie "${mediaTitle}". 
    You must respond completely in character. Do NOT break character under any circumstances. 
    Adopt the exact tone, vocabulary, worldview, and personality of ${characterName}. 
    Keep your responses relatively concise (2-4 sentences) so it feels like a real text message conversation.`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-flash-latest", // Updated to the current stable model
      systemInstruction: systemInstruction 
    });

    const chat = model.startChat({
      history: chatHistory || []
    });

    const result = await chat.sendMessage(userMessage);
    const aiResponse = result.response.text();

    res.status(200).json({ reply: aiResponse });

  } catch (error) {
    console.error("Gemini AI Error:", error);
    res.status(500).json({ message: "The character's connection was lost in the void." });
  }
});

// ==========================================
// 🔮 AI RECOMMENDATION ENGINE (JSON MODE)
// ==========================================
router.post('/recommend', verifyToken, async (req, res) => {
  try {
    const { finishedItems } = req.body;

    if (!finishedItems || finishedItems.length === 0) {
      return res.status(400).json({ message: "You need to finish some items first!" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // 🔥 THE FIX: We forcefully lock Gemini into "JSON Mode"
    const model = genAI.getGenerativeModel({ 
      model: "gemini-flash-latest", // Updated to the current stable model
      generationConfig: { responseMimeType: "application/json" } 
    });

    const prompt = `
      The user has finished and enjoyed the following media: ${finishedItems.join(', ')}.
      Recommend exactly 3 new books, movies, or TV series they should consume next.
      
      You must respond using this exact JSON schema:
      [
        {"title": "Media Title", "mediaType": "book or movie or series", "reason": "A brief explanation of why..."}
      ]
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Because of JSON mode, we don't need messy regex cleanup. It is perfectly safe to parse.
    const recommendations = JSON.parse(text);
    res.status(200).json(recommendations);

  } catch (error) {
    console.error("AI Recommendation Error:", error);
    if (error.status === 429) {
        res.status(429).json({ message: "The Oracle is currently meditating. Please try again in a minute." });
    } else {
        res.status(500).json({ message: "An error occurred in the summoning room." });
    }
  }
});

// ==========================================
// 📝 AI TBR SUMMARY GENERATOR
// ==========================================
router.post('/summarize', verifyToken, async (req, res) => {
  try {
    const { title, mediaType } = req.body;
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Using your confirmed working model
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `Provide a punchy, 3-sentence summary of the ${mediaType} titled "${title}". 
    Focus on the "vibe" and why a fan of literature or cinema would enjoy it. 
    Do not give spoilers.`;

    const result = await model.generateContent(prompt);
    res.status(200).json({ summary: result.response.text() });
  } catch (error) {
    res.status(500).json({ message: "The librarian is speechless." });
  }
});

module.exports = router;