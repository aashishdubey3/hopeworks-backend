const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const User = require('../models/User');

// 📧 1. Setup Google OAuth2 Engine
const OAuth2 = google.auth.OAuth2;
const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// 📧 2. Build the Transporter Generator
const createTransporter = async () => {
  try {
    const accessToken = await new Promise((resolve, reject) => {
      oauth2Client.getAccessToken((err, token) => {
        if (err) {
          console.error("🚨 Failed to generate access token:", err);
          reject(err);
        }
        resolve(token);
      });
    });

    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,
        accessToken,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN
      }
    });
  } catch (error) {
    console.error("🚨 Transporter Error:", error);
    return null;
  }
};

// 📝 3. REGISTER
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "A scholar with this email already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verificationToken,
      isVerified: false
    });

    await newUser.save();

    // 🔥 Send Email via Google API
    const emailTransporter = await createTransporter();
    if (!emailTransporter) throw new Error("Could not create email transporter");

    const verifyLink = `${process.env.FRONTEND_URL}/verify/${verificationToken}`;
    await emailTransporter.sendMail({
      from: `"The Lantern Library" <${process.env.EMAIL_USER}>`,
      to: newUser.email,
      subject: "Welcome Scholar - Verify Your Archives",
      html: `
        <div style="background: #1a1a2e; color: #ecf0f1; padding: 30px; text-align: center; font-family: sans-serif; border: 1px solid #f39c12; border-radius: 10px;">
          <h2 style="color: #f39c12;">Welcome to The Lantern Library</h2>
          <p style="font-size: 16px;">We must verify your identity before granting access to the archives.</p>
          <a href="${verifyLink}" style="display: inline-block; padding: 12px 25px; margin-top: 20px; background: #f39c12; color: #1a1a2e; text-decoration: none; font-weight: bold; border-radius: 5px;">Verify My Account</a>
          <p style="margin-top: 30px; font-size: 12px; color: #7f8c8d;">If you did not request this, ignore this scroll.</p>
        </div>
      `
    });

    res.status(201).json({ message: "Registration successful! Please check your email to verify your account." });
  } catch (error) {
    console.error("🚨 Registration Error:", error);
    res.status(500).json({ message: "Registration failed. Server error." });
  }
});

// ✅ 4. VERIFY EMAIL
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({ verificationToken: req.params.token });
    if (!user) return res.status(400).json({ message: "Invalid or expired verification link." });

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.status(200).json({ message: "Account verified successfully! You may now log in." });
  } catch (error) {
    console.error("🚨 Verification Error:", error);
    res.status(500).json({ message: "Verification failed." });
  }
});

// 🚪 5. LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials." });

    if (!user.isVerified) {
      return res.status(403).json({ message: "Please verify your email before entering the archives." });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    const userObject = user.toObject();
    delete userObject.password;

    res.status(200).json({ token, user: userObject });
  } catch (error) {
    console.error("🚨 Login Error:", error);
    res.status(500).json({ message: "Login failed." });
  }
});

// 🔑 6. FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ message: "If that email exists, a reset link has been sent." });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const emailTransporter = await createTransporter();
    if (!emailTransporter) throw new Error("Could not create email transporter");

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await emailTransporter.sendMail({
      from: `"The Lantern Library" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Password Reset Request",
      html: `
        <div style="background: #1a1a2e; color: #ecf0f1; padding: 30px; text-align: center; border: 1px solid #f39c12; border-radius: 10px;">
          <h2 style="color: #f39c12;">Reset Your Password</h2>
          <p>You requested a password reset. Click the button below to set a new password. This link expires in 1 hour.</p>
          <a href="${resetLink}" style="display: inline-block; padding: 12px 25px; margin-top: 20px; background: #f39c12; color: #1a1a2e; text-decoration: none; font-weight: bold; border-radius: 5px;">Reset Password</a>
        </div>
      `
    });

    res.status(200).json({ message: "If that email exists, a reset link has been sent." });
  } catch (error) {
    console.error("🚨 Forgot Password Error:", error);
    res.status(500).json({ message: "Server error." });
  }
});

// 🛠️ 7. RESET PASSWORD
router.post('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({ 
      resetPasswordToken: req.params.token, 
      resetPasswordExpires: { $gt: Date.now() } 
    });

    if (!user) return res.status(400).json({ message: "Password reset link is invalid or has expired." });

    user.password = await bcrypt.hash(req.body.password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password successfully reset! You can now log in." });
  } catch (error) {
    console.error("🚨 Reset Password Error:", error);
    res.status(500).json({ message: "Failed to reset password." });
  }
});

module.exports = router;