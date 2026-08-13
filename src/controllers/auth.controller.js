const jwt = require('jsonwebtoken');
const User = require('../models/User');

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
});

const safeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);

const createToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    const error = new Error('Authentication is not configured.');
    error.statusCode = 500;
    throw error;
  }

  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!name || !normalizedEmail || !password) {
      const error = new Error('Name, email, and password are required.');
      error.statusCode = 400;
      throw error;
    }

    if (typeof name !== 'string' || typeof password !== 'string' || !isValidEmail(normalizedEmail)) {
      const error = new Error('Please provide valid registration details.');
      error.statusCode = 400;
      throw error;
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const error = new Error('An account with this email already exists.');
      error.statusCode = 409;
      throw error;
    }

    const user = await User.create({ name, email: normalizedEmail, password, role: 'user' });
    return res.status(201).json({ message: 'User registered successfully.', user: safeUser(user) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      error.statusCode = 400;
    }
    if (error.code === 11000) {
      error.message = 'An account with this email already exists.';
      error.statusCode = 409;
    }
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      const error = new Error('Email and password are required.');
      error.statusCode = 400;
      throw error;
    }

    if (typeof password !== 'string' || !isValidEmail(normalizedEmail)) {
      const error = new Error('Please provide valid login details.');
      error.statusCode = 400;
      throw error;
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      const error = new Error('Invalid email or password.');
      error.statusCode = 401;
      throw error;
    }

    if (!user.isActive) {
      const error = new Error('This account is inactive.');
      error.statusCode = 403;
      throw error;
    }

    const token = createToken(user._id.toString());
    return res.cookie('token', token, cookieOptions()).status(200).json({
      message: 'Login successful.',
      user: safeUser(user)
    });
  } catch (error) {
    return next(error);
  }
};

const logout = (req, res) => {
  const options = cookieOptions();
  delete options.maxAge;
  return res.clearCookie('token', options).status(200).json({ message: 'Logout successful.' });
};

const getCurrentUser = (req, res) => res.status(200).json({ user: safeUser(req.user) });

module.exports = { register, login, logout, getCurrentUser };
