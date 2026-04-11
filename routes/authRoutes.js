const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

// 📧 Configure the Email Sender
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 📝 1. REGISTER
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "A scholar with this email already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate a random 64-character token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verificationToken,
      isVerified: false
    });

    await newUser.save();

    // Send the Verification Email
    const verifyLink = `${process.env.FRONTEND_URL}/verify/${verificationToken}`;
    await transporter.sendMail({
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
    console.error("🚨 Registration Error:", error); // <-- FORCES RENDER TO PRINT THE ERROR
    res.status(500).json({ message: "Registration failed. Server error." });
  }
});

// ✅ 2. VERIFY EMAIL
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({ verificationToken: req.params.token });
    if (!user) return res.status(400).json({ message: "Invalid or expired verification link." });

    user.isVerified = true;
    user.verificationToken = undefined; // Clear the token
    await user.save();

    res.status(200).json({ message: "Account verified successfully! You may now log in." });
  } catch (error) {
    console.error("🚨 Verification Error:", error);
    res.status(500).json({ message: "Verification failed." });
  }
});

// 🚪 3. LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials." });

    // 🔥 THE NEW GUARDRAIL
    if (!user.isVerified) {
      return res.status(403).json({ message: "Please verify your email before entering the archives." });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    // Strip password before sending to frontend
    const userObject = user.toObject();
    delete userObject.password;

    res.status(200).json({ token, user: userObject });
  } catch (error) {
    console.error("🚨 Login Error:", error);
    res.status(500).json({ message: "Login failed." });
  }
});

// 🔑 4. FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ message: "If that email exists, a reset link has been sent." });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 Hour limit
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    
    await transporter.sendMail({
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
    console.error("🚨 Forgot Password Error:", error); // <-- FORCES RENDER TO PRINT THE ERROR
    res.status(500).json({ message: "Server error." });
  }
});

// 🛠️ 5. RESET PASSWORD
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