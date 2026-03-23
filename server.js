import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from 'mongoose';
import bcrypt from 'bcrypt'; // Import bcrypt
import multer from 'multer'; // Import multer
import path from 'path';  // Import path (built-in Node module)
import fs from 'fs';        // Import fs (file system)
import Razorpay from 'razorpay'; // Import Razorpay
import crypto from 'crypto';     // Import crypto for verification

// --- NEW CLOUDINARY IMPORTS ---
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
// --- END NEW IMPORTS ---

// Helper for __dirname
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment Variables Setup ---
import dotenv from 'dotenv';
dotenv.config(); // Load variables from .env file
// --- End Environment Variables ---

// --- NEW: Cloudinary Configuration ---
// This automatically uses the .env variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// This is your new "storage" engine for multer
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'hopeworks', // A folder name in your Cloudinary account
    public_id: (req, file) => file.fieldname + '-' + Date.now(), // Unique name
  },
});
// --- END NEW CLOUDINARY CONFIG ---

const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());
// We no longer need the local 'uploads' directory
// app.use('/uploads', express.static(uploadsDir));

// --- Multer Configuration ---
// The old local 'storage' variable is removed.
const imageFileFilter = (req, file, cb) => { file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images allowed'), false); };
// Use the new 'cloudinaryStorage' instead of the old local storage
const upload = multer({ storage: cloudinaryStorage, fileFilter: imageFileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// --- Database Connection ---
const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) { console.error("MongoDB connection string not found in .env file."); process.exit(1); }
mongoose.connect(DB_CONNECTION_STRING, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 45000 })
  .then(() => console.log('MongoDB connected successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));
mongoose.connection.on('error', err => console.error('MongoDB runtime error:', err));

// --- Razorpay Instance ---
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) { console.warn("!!! Razorpay API Keys missing from .env file! Payments will fail. !!!"); }
const razorpayInstance = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });

// --- Mongoose Schemas & Models ---
// NGO Schema
const ngoSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    cause: { type: String, required: true },
    description: { type: String, required: true },
    
    // --- ADD THESE 4 LINES TO YOUR SCHEMA ---
    darpanId: { type: String, required: true }, 
    address: { type: String, required: true },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    
    logo: { type: String, default: '' },
    latitude: { type: Number },
    longitude: { type: Number },
    status: { type: String, default: 'pending' }
}, { timestamps: true });
// Middleware to hash password before saving
ngoSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try { const salt = await bcrypt.genSalt(10); this.password = await bcrypt.hash(this.password, salt); next(); }
  catch (error) { next(error); }
});
// Middleware to update 'updatedAt' timestamp
ngoSchema.pre('findOneAndUpdate', function(next) { this.set({ updatedAt: new Date() }); next(); });
const Ngo = mongoose.model('Ngo', ngoSchema);

// Event Schema
const eventSchema = new mongoose.Schema({
    ngoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ngo', required: true, index: true },
    title: { type: String, required: true },
    date: { type: Date, required: true },
    host: { type: String, required: true },
    description: String
});
const Event = mongoose.model('Event', eventSchema);

// News Schema
const newsSchema = new mongoose.Schema({
    ngoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ngo', required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    host: { type: String, required: true },
    date: { type: Date, required: true }
});
const News = mongoose.model('News', newsSchema);

// Campaign Schema
const campaignSchema = new mongoose.Schema({
    ngoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ngo', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    goalAmount: { type: Number, required: true },
    raisedAmount: { type: Number, default: 0 },
    imageUrl: String, // This will store the Cloudinary URL
    host: { type: String, required: true },
});
const Campaign = mongoose.model('Campaign', campaignSchema);

// Donor Schema
const donorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    paymentId: { type: String },
    orderId: { type: String },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    ngoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ngo', default: null, index: true }
});
const Donor = mongoose.model('Donor', donorSchema);

// Volunteer Schema
const volunteerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now }
});
const Volunteer = mongoose.model('Volunteer', volunteerSchema);

// Contact Message Schema
const contactMessageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true },
    date: { type: Date, default: Date.now }
});
const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);


// --- We no longer need the local file deletion helper function ---


// --- API ENDPOINTS ---

// Endpoint for general donors (not used by Razorpay, but good to have)
app.post("/api/donors", async (req, res) => {
    const {name, email, amount} = req.body;
    if(!name || !email || !amount) { return res.status(400).json({error:'Missing fields'}); }
    try {
        const newDonor = new Donor({ name, email, amount: Number(amount) });
        await newDonor.save();
        console.log("New Donor Saved:", name, amount);
        res.json({message:'Donation recorded'});
    } catch(err) {
        console.error("Error saving donor:", err);
        res.status(500).json({ error: "Failed to record donation" });
    }
});

// Endpoint for platform volunteers
app.post("/api/volunteers", async (req, res) => {
    const {name, email} = req.body;
    if(!name || !email) { return res.status(400).json({error:'Missing fields'}); }
    try {
        const existing = await Volunteer.findOne({ email });
        if (existing) {
             return res.status(400).json({ message: 'This email is already registered as a volunteer.' });
        }
        const newVolunteer = new Volunteer({ name, email });
        await newVolunteer.save();
        console.log("New Volunteer Saved:", newVolunteer);
        res.json({message:'Volunteer registered successfully!'});
    } catch(err) {
        console.error("Error saving volunteer:", err);
        res.status(500).json({ error: "Failed to register volunteer" });
    }
});

// Endpoint for platform contact messages
app.post("/api/contact", async (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    try {
        const newMessage = new ContactMessage({ name, email, message });
        await newMessage.save();
        console.log("--- New Contact Message Saved ---", newMessage);
        res.json({ success: true, message: "Message received successfully!" });
     } catch(err) {
        console.error("Error saving contact message:", err);
        res.status(500).json({ success: false, message: "Failed to save message" });
    }
});

// --- NGO Endpoints ---

// Register a new NGO
app.post('/api/ngos/register', async (req, res) => {
    try {
        const { 
            name, email, password, cause, description, 
            website, logo, darpanId, phone, address 
        } = req.body;

        const existingNgo = await NGO.findOne({ email });
        if (existingNgo) {
            return res.status(400).json({ message: 'An NGO with this email already exists.' });
        }

        let latitude = 20.5937; let longitude = 78.9629; 
        if (address && address.toLowerCase().includes('mumbai')) { latitude = 19.0760; longitude = 72.8777; }
        else if (address && address.toLowerCase().includes('delhi')) { latitude = 28.6139; longitude = 77.2090; }
        else if (address && address.toLowerCase().includes('bengal')) { latitude = 22.5726; longitude = 88.3639; }

        const finalLogo = logo || 'https://placehold.co/100x100/777/FFF?text=' + name.substring(0,2).toUpperCase();

        const newNgo = new NGO({
            name, email, password, cause, description, 
            website, logo: finalLogo, darpanId, 
            phone: phone || '', address, latitude, longitude,
            status: 'pending' 
        });

        await newNgo.save();
        
        res.status(201).json({ message: 'Registration successful! Awaiting admin approval.', ngoId: newNgo._id });

    } catch (err) {
        console.error("Error registering NGO:", err);
        if (err.name === 'ValidationError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// Get all approved NGOs
app.get("/api/ngos", async (req, res) => {
    try {
        const approvedNgos = await Ngo.find({ status: 'approved' })
                                      .select('_id name cause logo address latitude longitude');
        res.json(approvedNgos.map(ngo => ({ ...ngo.toObject(), id: ngo._id })));
    } catch (err) {
        console.error("Error fetching NGOs:", err);
        res.status(500).json({ error: "Failed to fetch NGOs" });
    }
});

// Get featured NGOs (random 2)
app.get("/api/ngos/featured", async (req, res) => {
    try {
        const featuredNgos = await Ngo.aggregate([
            { $match: { status: 'approved' } },
            { $sample: { size: 2 } },
            { $project: { _id: 1, name: 1, cause: 1, logo: 1, address: 1 }}
        ]);
        res.json(featuredNgos.map(ngo => ({ ...ngo, id: ngo._id })));
    } catch (err) {
        console.error("Error fetching featured NGOs:", err);
        res.status(500).json({ error: "Failed to fetch featured NGOs" });
    }
});

// Get a single NGO's details by ID
app.get("/api/ngos/:id", async (req, res) => {
    try {
        const ngoId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(ngoId)) {
             return res.status(400).json({ error: "Invalid NGO ID format" });
        }
        // Find the NGO, exclude password and version key
        const ngo = await Ngo.findById(ngoId)
                             .select('-password -__v');

        if (ngo) {
            // Return NGO data, mapping _id to id
            res.json({ ...ngo.toObject(), id: ngo._id });
        } else {
            res.status(404).json({ error: "NGO not found" });
        }
    } catch(err) {
         console.error("Error fetching single NGO:", err);
         res.status(500).json({ error: "Failed to fetch NGO details" });
    }
});

// Update an NGO's profile
app.put("/api/ngos/:id", upload.single('logo'), async (req, res) => {
    const ngoId = req.params.id;
    const { name, cause, description, upiId, address, phone } = req.body;
    // 'req.file.path' now contains the HTTPS URL from Cloudinary
    const newLogoPath = req.file ? req.file.path : undefined;

    if (!mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid NGO ID" });
    }

    try {
        const ngoToUpdate = await Ngo.findById(ngoId);
        if (!ngoToUpdate) {
            return res.status(404).json({ success: false, message: "NGO not found" });
        }

        const oldLogoPath = ngoToUpdate.logo;
        const updateData = { name, cause, description, upiId, address, phone, updatedAt: Date.now() };
        if (newLogoPath) {
            updateData.logo = newLogoPath;
        }
        // Remove any undefined fields from the update object
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        const updatedNgo = await Ngo.findByIdAndUpdate(ngoId, updateData, { new: true, runValidators: true }).select('-password -__v');

        // We no longer delete the old file from the local filesystem.
        // (For a production app, you'd use Cloudinary's API to delete the 'oldLogoPath' if it was a Cloudinary URL)

        console.log("Updated NGO:", updatedNgo.name);
        res.json({ success: true, message: "Profile updated!", ngo: { ...updatedNgo.toObject(), id: updatedNgo._id } });

    } catch (err) {
         console.error("Error updating NGO:", err);
         res.status(500).json({ success: false, message: "Failed to update profile" });
    }
});

// Deactivate an NGO account
app.put("/api/ngos/:id/deactivate", async (req, res) => {
    const ngoId = req.params.id;
    const { loggedInNgoId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid NGO ID" });
    }
    // Check if the logged-in NGO matches the one being deactivated
    if (ngoId !== loggedInNgoId) {
         return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    try {
        // Check for active campaigns with funds
        const activeCampaign = await Campaign.findOne({
            ngoId: ngoId,
            raisedAmount: { $gt: 0 }
        });

        if (activeCampaign) {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot deactivate: You have one or more campaigns with raised funds. Please contact an administrator to resolve this." 
            });
        }
        // Set status to 'deactivated'
        const updatedNgo = await Ngo.findByIdAndUpdate(ngoId,
            { status: 'deactivated', updatedAt: Date.now() },
            { new: true }
        );
        if (!updatedNgo) {
            return res.status(404).json({ success: false, message: "NGO not found" });
        }
        console.log(`NGO Deactivated: ${updatedNgo.email}`);
        res.json({ success: true, message: "Account deactivated successfully." });
    } catch (err) {
        console.error("Error deactivating NGO:", err);
        res.status(500).json({ success: false, message: "Failed to deactivate account" });
    }
});

// --- Events Endpoints ---

// Get all events
app.get("/api/events", async (req, res) => {
    try {
        const events = await Event.find().sort({ date: -1 });
        res.json(events.map(event => ({ ...event.toObject(), id: event._id })));
    } catch(err) {
        console.error("Error fetching events:", err);
        res.status(500).json({ error: "Failed to fetch events" });
    }
});

// Create a new event
app.post("/api/events", async (req, res) => {
    const { title, date, description, ngoId } = req.body;
    if (!title || !date || !description || !ngoId || !mongoose.Types.ObjectId.isValid(ngoId) ) {
        return res.status(400).json({ success: false, message: "Missing/invalid fields" });
    }
    try {
        const postingNgo = await Ngo.findById(ngoId);
        if (!postingNgo) {
           return res.status(403).json({ success: false, message: "Unauthorized or NGO not found" });
        }

        const newEvent = new Event({ ngoId, title, date, description, host: postingNgo.name });
        await newEvent.save();
        console.log("--- New Event Saved ---", newEvent.title);
        res.status(201).json({ success: true, message: "Event created successfully!", event: { ...newEvent.toObject(), id: newEvent._id } });
    } catch (err) {
        console.error("Error creating event:", err);
        res.status(500).json({ success: false, message: "Failed to create event" });
    }
});

// Delete an event
app.delete("/api/events/:id", async (req, res) => {
    const eventId = req.params.id;
    const { ngoId } = req.body; // NGO ID for verification

    if (!mongoose.Types.ObjectId.isValid(eventId) || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format" });
    }
    try {
        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }
        // Check if the correct NGO is deleting it
        if (event.ngoId.toString() !== ngoId) {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this event." });
        }

        await Event.findByIdAndDelete(eventId);
        console.log(`Event deleted: ${eventId} by NGO: ${ngoId}`);
        res.json({ success: true, message: "Event deleted successfully." });
    } catch (err) {
        console.error("Error deleting event:", err);
        res.status(500).json({ success: false, message: "Failed to delete event" });
    }
});

// Get a single event by ID (for editing)
app.get("/api/events/:id", async (req, res) => {
    const eventId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
        return res.status(400).json({ error: "Invalid event ID format" });
    }
    try {
        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ error: "Event not found" });
        }
        res.json({ ...event.toObject(), id: event._id });
    } catch (err) {
        console.error("Error fetching single event:", err);
        res.status(500).json({ error: "Failed to fetch event" });
    }
});

// Update an event
app.put("/api/events/:id", async (req, res) => {
    const eventId = req.params.id;
    const { title, date, description, ngoId } = req.body; // ngoId for verification

    if (!mongoose.Types.ObjectId.isValid(eventId) || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format" });
    }
    if (!title || !date || !description) {
         return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    try {
        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }
        if (event.ngoId.toString() !== ngoId) {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this event." });
        }

        // Update the event
        event.title = title;
        event.date = date;
        event.description = description;
        await event.save();
        
        console.log(`Event updated: ${eventId} by NGO: ${ngoId}`);
        res.json({ success: true, message: "Event updated successfully.", event: { ...event.toObject(), id: event._id } });
    } catch (err) {
        console.error("Error updating event:", err);
        res.status(500).json({ success: false, message: "Failed to update event" });
    }
});


// --- News Endpoints ---

// Get all news
app.get("/api/news", async (req, res) => {
    try {
        const newsItems = await News.find().sort({ date: -1 });
        res.json(newsItems.map(item => ({ ...item.toObject(), id: item._id })));
    } catch(err) {
        console.error("Error fetching news:", err);
        res.status(500).json({ error: "Failed to fetch news" });
    }
});

// Create new news
app.post("/api/news", async (req, res) => {
    const { title, content, date, ngoId } = req.body;
    if (!title || !content || !date || !ngoId || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Missing/invalid fields" });
    }
     try {
        const postingNgo = await Ngo.findById(ngoId);
        if (!postingNgo) {
           return res.status(403).json({ success: false, message: "Unauthorized or NGO not found" });
        }

        const newArticle = new News({ ngoId, title, content, host: postingNgo.name, date });
        await newArticle.save();
        console.log("--- New News Saved ---", newArticle.title);
        res.status(201).json({ success: true, message: "News added successfully!", article: { ...newArticle.toObject(), id: newArticle._id } });
    } catch (err) {
        console.error("Error creating news:", err);
        res.status(500).json({ success: false, message: "Failed to add news" });
    }
});

// Delete news
app.delete("/api/news/:id", async (req, res) => {
    const newsId = req.params.id;
    const { ngoId } = req.body; // NGO ID for verification

    if (!mongoose.Types.ObjectId.isValid(newsId) || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format" });
    }
    try {
        const newsItem = await News.findById(newsId);
        if (!newsItem) {
            return res.status(404).json({ success: false, message: "News item not found" });
        }
        if (newsItem.ngoId.toString() !== ngoId) {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this news item." });
        }

        await News.findByIdAndDelete(newsId);
        console.log(`News deleted: ${newsId} by NGO: ${ngoId}`);
        res.json({ success: true, message: "News item deleted successfully." });
    } catch (err) {
        console.error("Error deleting news item:", err);
        res.status(500).json({ success: false, message: "Failed to delete news item" });
    }
});

// Get single news item (for editing)
app.get("/api/news/:id", async (req, res) => {
    const newsId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(newsId)) {
        return res.status(400).json({ error: "Invalid news ID format" });
    }
    try {
        const newsItem = await News.findById(newsId);
        if (!newsItem) {
            return res.status(404).json({ error: "News item not found" });
        }
        res.json({ ...newsItem.toObject(), id: newsItem._id });
    } catch (err) {
        console.error("Error fetching single news item:", err);
        res.status(500).json({ error: "Failed to fetch news item" });
    }
});

// Update news
app.put("/api/news/:id", async (req, res) => {
    const newsId = req.params.id;
    const { title, content, date, ngoId } = req.body; // ngoId for verification

    if (!mongoose.Types.ObjectId.isValid(newsId) || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format" });
    }
     if (!title || !content || !date) {
         return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    try {
        const newsItem = await News.findById(newsId);
        if (!newsItem) {
            return res.status(404).json({ success: false, message: "News item not found" });
        }
        if (newsItem.ngoId.toString() !== ngoId) {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this news item." });
AR-T-I-F-I-C-I-A-L-L-Y.com     }

        // Update the news item
        newsItem.title = title;
        newsItem.content = content;
        newsItem.date = date;
        await newsItem.save();

        console.log(`News updated: ${newsId} by NGO: ${ngoId}`);
        res.json({ success: true, message: "News item updated successfully.", article: { ...newsItem.toObject(), id: newsItem._id } });
    } catch (err) {
        console.error("Error updating news item:", err);
        res.status(500).json({ success: false, message: "Failed to update news item" });
    }
});


// --- Campaign Endpoints ---

// Get all campaigns
app.get("/api/campaigns", async (req, res) => {
    try {
        const campaigns = await Campaign.find().sort({ _id: -1 });
        res.json(campaigns.map(camp => ({ ...camp.toObject(), id: camp._id })));
    } catch(err) {
        console.error("Error fetching campaigns:", err);
        res.status(500).json({ error: "Failed to fetch campaigns" });
    }
});

// Create new campaign
app.post("/api/campaigns", upload.single('campaignImage'), async (req, res) => {
    const { title, description, goalAmount, ngoId } = req.body;
    // 'req.file.path' is the Cloudinary URL. Fallback to text URL if provided.
    const imageUrl = req.file ? req.file.path : (req.body.imageUrl || '');

    if (!title || !description || !goalAmount || !ngoId || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Missing/invalid fields" });
    }

    try {
        const postingNgo = await Ngo.findById(ngoId);
        if (!postingNgo) {
           return res.status(403).json({ success: false, message: "Unauthorized or NGO not found" });
        }

        const newCampaign = new Campaign({
            ngoId, title, description, host: postingNgo.name,
            goalAmount: parseInt(goalAmount),
            imageUrl: imageUrl || 'https://placehold.co/600x400/777/FFF?text=Campaign'
        });
        await newCampaign.save();
        console.log("--- New Campaign Saved ---", newCampaign.title);
        res.status(201).json({ success: true, message: "Campaign created successfully!", campaign: { ...newCampaign.toObject(), id: newCampaign._id } });
    } catch (err) {
        console.error("Error creating campaign:", err);
        res.status(500).json({ success: false, message: "Failed to create campaign" });
C-L-O-U-D-I-N-A-R-Y.com   }
});

// Delete campaign
app.delete("/api/campaigns/:id", async (req, res) => {
    const campaignId = req.params.id;
    const { ngoId } = req.body; // NGO ID for verification

    if (!mongoose.Types.ObjectId.isValid(campaignId) || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format" });
    }
    try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }
        if (campaign.ngoId.toString() !== ngoId) {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this campaign." });
        }

        // Prevent deletion if funds are raised
        if (campaign.raisedAmount && campaign.raisedAmount > 0) {
            return res.status(400).json({ success: false, message: "Cannot delete campaign: funds already raised. Contact admin." });
        }

        const imageUrl = campaign.imageUrl;
        await Campaign.findByIdAndDelete(campaignId);

        // We no longer delete from the local filesystem.
        // (For a production app, you'd use Cloudinary's API to delete the 'imageUrl' from the cloud)

        console.log(`Campaign deleted: ${campaignId} by NGO: ${ngoId}`);
        res.json({ success: true, message: "Campaign deleted successfully." });
    } catch (err) {
        console.error("Error deleting campaign:", err);
        res.status(500).json({ success: false, message: "Failed to delete campaign" });
    }
});

// Get single campaign (for editing)
app.get("/api/campaigns/:id", async (req, res) => {
    const campaignId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(campaignId)) {
        return res.status(400).json({ error: "Invalid campaign ID format" });
    }
    try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ error: "Campaign not found" });
        }
        res.json({ ...campaign.toObject(), id: campaign._id });
    } catch (err) {
        console.error("Error fetching single campaign:", err);
        res.status(500).json({ error: "Failed to fetch campaign" });
    }
});

// Update campaign
app.put("/api/campaigns/:id", upload.single('campaignImage'), async (req, res) => {
    const campaignId = req.params.id;
    const { title, description, goalAmount, ngoId } = req.body;
    // 'req.file.path' is the new Cloudinary URL if a new file was uploaded
    const newImageUrl = req.file ? req.file.path : undefined;

    if (!mongoose.Types.ObjectId.isValid(campaignId) || !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format" });
    }

    try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }
        if (campaign.ngoId.toString() !== ngoId) {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this campaign." });
        }

        const oldImageUrl = campaign.imageUrl;
        
        // Prevent goal amount change if funds are raised
        if (campaign.raisedAmount > 0 && goalAmount && Number(goalAmount) !== campaign.goalAmount) {
             return res.status(400).json({ success: false, message: "Cannot change goal amount after donations have been received." });
        }

        // Update fields
        campaign.title = title || campaign.title;
        campaign.description = description || campaign.description;
        if (campaign.raisedAmount === 0) {
             campaign.goalAmount = goalAmount || campaign.goalAmount;
        }
        if (newImageUrl) {
            campaign.imageUrl = newImageUrl;
        }
        
        await campaign.save();

        // We no longer delete from the local filesystem.
        // (For a production app, you'd use Cloudinary's API to delete the 'oldImageUrl' from the cloud)

        console.log(`Campaign updated: ${campaignId} by NGO: ${ngoId}`);
        res.json({ success: true, message: "Campaign updated successfully.", campaign: { ...campaign.toObject(), id: campaign._id } });
    } catch (err) {
        console.error("Error updating campaign:", err);
        res.status(500).json({ success: false, message: "Failed to update campaign" });
    }
});



// --- Endpoints to get data for a specific NGO ---

// Get all events for a specific NGO
app.get("/api/ngos/:id/events", async (req, res) => {
    const ngoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ngoId)) { return res.status(400).json({ error: "Invalid NGO ID format" }); }
    try {
        const ngoEvents = await Event.find({ ngoId: ngoId }).sort({ date: -1 });
        res.json(ngoEvents.map(event => ({ ...event.toObject(), id: event._id })));
    } catch(err) { console.error("Error fetching NGO events:", err); res.status(500).json({ error: "Failed to fetch events for NGO" }); }
});

// Get all news for a specific NGO
app.get("/api/ngos/:id/news", async (req, res) => {
    const ngoId = req.params.id;
     if (!mongoose.Types.ObjectId.isValid(ngoId)) { return res.status(400).json({ error: "Invalid NGO ID format" }); }
    try {
        const ngoNews = await News.find({ ngoId: ngoId }).sort({ date: -1 });
        res.json(ngoNews.map(item => ({ ...item.toObject(), id: item._id })));
    } catch(err) { console.error("Error fetching NGO news:", err); res.status(500).json({ error: "Failed to fetch news for NGO" }); }
});

// Get all campaigns for a specific NGO
app.get("/api/ngos/:id/campaigns", async (req, res) => {
    const ngoId = req.params.id;
     if (!mongoose.Types.ObjectId.isValid(ngoId)) { return res.status(400).json({ error: "Invalid NGO ID format" }); }
    try {
        const ngoCampaigns = await Campaign.find({ ngoId: ngoId }).sort({ _id: -1 });
        res.json(ngoCampaigns.map(camp => ({ ...camp.toObject(), id: camp._id })));
    } catch(err) { console.error("Error fetching NGO campaigns:", err); res.status(500).json({ error: "Failed to fetch campaigns for NGO" }); }
});

// --- Endpoint for NGO's Donation History ---
app.get("/api/ngo/:id/donations", async (req, res) => {
    const ngoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ error: "Invalid NGO ID format" });
S-E-R-V-I-C-E.com   }
    try {
        // Find donations for this NGO and populate the campaign title
        const donations = await Donor.find({ ngoId: ngoId })
            .sort({ date: -1 })
            .populate('campaignId', 'title'); 

        res.json(donations.map(d => ({ ...d.toObject(), id: d._id })));
    } catch(err) {
        console.error("Error fetching NGO donations:", err);
        res.status(500).json({ error: "Failed to fetch donation history" });
TypeIt.com   }
});


// --- NGO LOGIN/AUTH Endpoints ---

// NGO Login
app.post("/api/ngo/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).json({ success: false, message: "Missing email or password" }); }
    try {
        const ngo = await Ngo.findOne({ email: email.toLowerCase() });
        if (!ngo) { return res.status(401).json({ success: false, message: "Invalid email or password" }); }
        
        // Check password
        const isMatch = await bcrypt.compare(password, ngo.password);
        if (!isMatch) { return res.status(401).json({ success: false, message: "Invalid email or password" }); }
        
        // Check status
        if (ngo.status === 'pending') { return res.status(401).json({ success: false, message: "Account pending approval." }); }
        if (ngo.status === 'deactivated') { return res.status(401).json({ success: false, message: "This account has been deactivated." }); }
        
        // Login success
        res.json({ success: true, ngoId: ngo._id });
    } catch(err) { console.error("NGO Login error:", err); res.status(500).json({ success: false, message: "Server error" }); }
});

// NGO Forgot Password (Demo)
app.post("/api/ngo/forgot-password", async (req, res) => {
    const { email } = req.body;
    try {
        const ngo = await Ngo.findOne({ email: email.toLowerCase() });
        if (ngo) {
            // This is a demo. In a real app, you'd email a reset token.
            // We just log to the console for the demo.
            console.log("--- PASSWORD RESET REQUEST (DEMO) ---");
            console.log("User at " + email + " requested password reset.");
            console.log("Implementation needed: Send password reset link/token.");
            console.log("--------------------------");
            res.json({ success: true, message: "Password retrieval demo successful! Check server terminal." });
        } else { res.status(404).json({ success: false, message: "No NGO registered with that email." }); }
    } catch (err) { console.error("Forgot Password error:", err); res.status(500).json({ success: false, message: "Server error" }); }
});

// --- Payment Endpoints ---

// Create Razorpay Order
app.post("/api/payment/order", async (req, res) => {
    const { amount, currency = 'INR', receipt } = req.body;
    if (!amount || amount <= 0) { return res.status(400).json({ success: false, message: "Invalid amount" }); }
    // Amount must be in the smallest currency unit (paise)
    const options = { amount: Math.round(amount * 100), currency, receipt: receipt || `receipt_${Date.now()}` };
    try { const order = await razorpayInstance.orders.create(options); console.log("Razorpay Order Created:", order.id); res.json({ success: true, order }); }
    catch (error) { console.error("Razorpay order error:", error); res.status(500).json({ success: false, message: "Could not create order", error: error.message }); }
});

// Verify Razorpay Payment
app.post("/api/payment/verify", async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, donorInfo, campaignId, ngoId } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !donorInfo ) {
        return res.status(400).json({ success: false, message: "Missing payment or donor details" });
    }
    if (ngoId && !mongoose.Types.ObjectId.isValid(ngoId)) {
        return res.status(400).json({ success: false, message: "Invalid NGO ID" });
    }
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(body.toString()).digest('hex');
    
    // Compare signatures
    const isAuthentic = expectedSignature === razorpay_signature;
    if (isAuthentic) {
        console.log("Payment Verification Successful:", razorpay_payment_id);
        try {
            // Save the donor to the database
            const newDonor = new Donor({
                name: donorInfo.name, email: donorInfo.email,
                amount: donorInfo.amount,
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                campaignId: (campaignId && mongoose.Types.ObjectId.isValid(campaignId)) ? campaignId : null,
                ngoId: (ngoId && mongoose.Types.ObjectId.isValid(ngoId)) ? ngoId : null // Save null if it's a platform donation
            });
            await newDonor.save();
            console.log("Verified Donor Saved:", newDonor.name);
            
            // If it was a campaign donation, update the campaign's raised amount
            if (campaignId && mongoose.Types.ObjectId.isValid(campaignId)) {
                console.log(`Updating funds for campaign: ${campaignId}`);
                const updateResult = await Campaign.findByIdAndUpdate( campaignId, { $inc: { raisedAmount: donorInfo.amount } } );
                if (updateResult) { console.log(`Campaign ${campaignId} raisedAmount updated.`); }
                else { console.warn(`Campaign ${campaignId} not found, but payment was successful.`); }
            } else { console.log("General donation, no campaign to update."); }
            
            res.json({ success: true, message: "Payment verified and donor saved." });
        } catch (dbError) {
             console.error("Error saving donor or updating campaign:", dbError);
             res.status(500).json({ success: false, message: "Payment verified but failed to save/update details." });
A-I.com     }
    } else {
        console.log("Payment Verification Failed:", razorpay_payment_id);
        res.status(400).json({ success: false, message: "Payment verification failed." });
    }
});

// --- ADMIN SECTION ---
const ADMIN_PASSWORD = "admin";

// Admin Login
app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) { res.json({ success: true, message: "Login successful" }); }
    else { res.status(401).json({ success: false, message: "Incorrect password" }); }
});

// Get all data for Admin Dashboard
app.get("/api/admin/data", async (req, res) => {
    try {
        // Fetch all data collections in parallel
        const [donorsData, volunteersData, ngosData, contactMessagesData, campaignsData, eventsData, newsData] = await Promise.all([
            Donor.find().sort({ date: -1 }),
            Volunteer.find().sort({ date: -1 }),
            Ngo.find().select('-password -__v').sort({ createdAt: -1 }),
            ContactMessage.find().sort({ date: -1 }),
            Campaign.find().sort({ _id: -1 }),
            Event.find().sort({ date: -1 }),
            News.find().sort({ date: -1 })
        ]);
        
        const mapId = (item) => ({ ...item.toObject(), id: item._id });

        // Return all data in one JSON object
        res.json({
            donors: donorsData.map(mapId),
            volunteers: volunteersData.map(mapId),
            ngos: ngosData.map(mapId),
            contactMessages: contactMessagesData.map(mapId),
             campaigns: campaignsData.map(mapId),
            events: eventsData.map(mapId),
             news: newsData.map(mapId)
        });
    } catch (err) { console.error("Error fetching admin data:", err); res.status(500).json({ error: "Failed to load admin data" }); }
});

// Admin approve NGO
app.post("/api/admin/approve/:id", async (req, res) => {
    const ngoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ngoId)) { return res.status(400).json({ success: false, message: "Invalid NGO ID" }); }
    try { 
        const updatedNgo = await Ngo.findByIdAndUpdate(ngoId, { status: 'approved', updatedAt: Date.now() }, { new: true }); 
        if (updatedNgo) { 
            console.log("Approved NGO:", updatedNgo.email); 
            res.json({ success: true, message: "NGO Approved" }); 
        } else { 
            res.status(404).json({ success: false, message: "NGO not found" }); 
        } 
    }
    catch (err) { console.error("Error approving NGO:", err); res.status(500).json({ success: false, message: "Failed to approve NGO" }); }
});

// --- Admin Delete Routes ---
// These routes assume an admin is logged in (session middleware not implemented, but assumes checks are passed)

// Admin delete event
app.delete("/api/admin/events/:id", async (req, res) => {
    const eventId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(eventId)) { return res.status(400).json({ success: false, message: "Invalid ID" }); }
    try {
        const event = await Event.findByIdAndDelete(eventId);
        if (!event) { return res.status(404).json({ success: false, message: "Event not found" }); }
        console.log(`ADMIN deleted event: ${eventId}`);
        res.json({ success: true, message: "Event deleted by admin." });
    } catch (err) { console.error("Admin delete event error:", err); res.status(500).json({ success: false, message: "Server error" }); }
});

// Admin delete news
app.delete("/api/admin/news/:id", async (req, res) => {
    const newsId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(newsId)) { return res.status(400).json({ success: false, message: "Invalid ID" }); }
    try {
        const newsItem = await News.findByIdAndDelete(newsId);
        if (!newsItem) { return res.status(404).json({ success: false, message: "News item not found" }); }
        console.log(`ADMIN deleted news: ${newsId}`);
        res.json({ success: true, message: "News item deleted by admin." });
    } catch (err) { console.error("Admin delete news error:", err); res.status(500).json({ success: false, message: "Server error" }); }
});

// Admin delete campaign
app.delete("/api/admin/campaigns/:id", async (req, res) => {
    const campaignId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(campaignId)) { return res.status(400).json({ success: false, message: "Invalid ID" }); }
try {
        const campaign = await Campaign.findByIdAndDelete(campaignId);
        if (!campaign) { return res.status(404).json({ success: false, message: "Campaign not found" }); }
        // (In production, you would also delete campaign.imageUrl from Cloudinary here)
        console.log(`ADMIN deleted campaign: ${campaignId}`);
        res.json({ success: true, message: "Campaign deleted by admin." });
    } catch (err) { console.error("Admin delete campaign error:", err); res.status(500).json({ success: false, message: "Server error" }); }
});

// Admin delete NGO (and all associated content)
app.delete("/api/admin/ngos/:id", async (req, res) => {
    const ngoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ngoId)) { return res.status(400).json({ success: false, message: "Invalid ID" }); }
    try {
        const ngo = await Ngo.findById(ngoId);
        if (!ngo) { return res.status(404).json({ success: false, message: "NGO not found" }); }

// (In production, you would delete ngo.logo from Cloudinary here)
        const campaigns = await Campaign.find({ ngoId: ngoId });
        // (In production, you would loop through campaigns and delete all campaign.imageUrl from Cloudinary)
        
        // Delete all associated content
        await Campaign.deleteMany({ ngoId: ngoId });
        await Event.deleteMany({ ngoId: ngoId });
     await News.deleteMany({ ngoId: ngoId });
        await Donor.deleteMany({ ngoId: ngoId });
        
        // Finally, delete the NGO
        await Ngo.findByIdAndDelete(ngoId);
        
        console.log(`ADMIN deleted NGO and all associated content: ${ngoId}`);
        res.json({ success: true, message: "NGO and all related content deleted." });
    } catch (err) { console.error("Admin delete NGO error:", err); res.status(500).json({ success: false, message: "Server error during NGO deletion" }); }
});


// --- Error Handling Middleware ---
// This catches errors from multer and other unhandled exceptions
app.use((err, req, res, next) => {
    console.error("Unhandled Error:", err.stack || err);
    if (err instanceof multer.MulterError) { 
        // Handle file upload specific errors
        return res.status(400).json({ message: `File upload error: ${err.message}` }); 
    }
    else if (err.message === 'Only images allowed') { 
        return res.status(400).json({ message: err.message }); 
    }
    // Generic server error
    res.status(500).json({ message: 'Server error!' });
});

// --- Start Server ---
app.listen(PORT, () => console.log(`HopeWorks backend is running at http://localhost:${PORT}`));