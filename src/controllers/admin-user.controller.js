const mongoose = require('mongoose');
const User = require('../models/User');

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);
const isValidId = (id) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id) && mongoose.isValidObjectId(id);

const safeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const handleError = (error, next) => {
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    error.statusCode = 400;
  }
  if (error.code === 11000) {
    error.message = 'An account with this email already exists.';
    error.statusCode = 409;
  }
  return next(error);
};

const createAdminUser = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'email', 'password', 'role'];
    const unknownFields = Object.keys(req.body || {}).filter((field) => !allowedFields.includes(field));
    if (unknownFields.length) {
      throw createError(`Unknown field(s): ${unknownFields.join(', ')}.`, 400);
    }

    const { name, password, role } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    if (!name || !email || !password || !role) {
      throw createError('Name, email, password, and role are required.', 400);
    }
    if (typeof name !== 'string' || typeof password !== 'string' || !isValidEmail(email)) {
      throw createError('Please provide valid user details.', 400);
    }
    if (!['user', 'admin'].includes(role)) {
      throw createError('role must be either user or admin.', 400);
    }

    const user = await User.create({ name, email, password, role });
    return res.status(201).json({ message: 'User created successfully.', user: safeUser(user) });
  } catch (error) {
    return handleError(error, next);
  }
};

const parsePagination = (query) => {
  const pageValue = query.page === undefined ? '1' : query.page;
  const limitValue = query.limit === undefined ? '10' : query.limit;
  if (typeof pageValue !== 'string' || !/^[1-9]\d*$/.test(pageValue)) {
    throw createError('page must be a positive integer.', 400);
  }
  if (typeof limitValue !== 'string' || !/^[1-9]\d*$/.test(limitValue)) {
    throw createError('limit must be a positive integer.', 400);
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 50) {
    throw createError('limit must be a positive integer no greater than 50.', 400);
  }
  return { page, limit };
};

const listUsers = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const [users, totalUsers] = await Promise.all([
      User.find().select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments()
    ]);
    const totalPages = Math.ceil(totalUsers / limit);
    return res.status(200).json({
      users: users.map(safeUser),
      pagination: {
        page,
        limit,
        totalUsers,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    return handleError(error, next);
  }
};

const getUser = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      throw createError('Invalid user ID.', 400);
    }
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      throw createError('User not found.', 404);
    }
    return res.status(200).json({ user: safeUser(user) });
  } catch (error) {
    return handleError(error, next);
  }
};

const updateUser = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      throw createError('Invalid user ID.', 400);
    }
    const allowedFields = ['name', 'email', 'role', 'isActive'];
    const updateFields = Object.keys(req.body || {});
    const unknownFields = updateFields.filter((field) => !allowedFields.includes(field));
    if (unknownFields.length || updateFields.length === 0) {
      throw createError(unknownFields.length ? `Unknown field(s): ${unknownFields.join(', ')}.` : 'Provide at least one field to update.', 400);
    }

    if (Object.hasOwn(req.body, 'name') && (typeof req.body.name !== 'string' || !req.body.name.trim())) {
      throw createError('name must be a non-empty string.', 400);
    }
    if (Object.hasOwn(req.body, 'email')) {
      const email = normalizeEmail(req.body.email);
      if (!isValidEmail(email)) throw createError('Please provide a valid email address.', 400);
      req.body.email = email;
    }
    if (Object.hasOwn(req.body, 'role') && !['user', 'admin'].includes(req.body.role)) {
      throw createError('role must be either user or admin.', 400);
    }
    if (Object.hasOwn(req.body, 'isActive') && typeof req.body.isActive !== 'boolean') {
      throw createError('isActive must be a boolean.', 400);
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      throw createError('User not found.', 404);
    }

    const demotesLastAdmin = user.role === 'admin' && user.isActive
      && ((Object.hasOwn(req.body, 'role') && req.body.role === 'user')
        || (Object.hasOwn(req.body, 'isActive') && req.body.isActive === false));
    if (demotesLastAdmin) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        throw createError('Cannot demote or deactivate the last active administrator.', 409);
      }
    }

    for (const field of updateFields) user[field] = req.body[field];
    await user.save();
    return res.status(200).json({ message: 'User updated successfully.', user: safeUser(user) });
  } catch (error) {
    return handleError(error, next);
  }
};

module.exports = { createAdminUser, listUsers, getUser, updateUser };
