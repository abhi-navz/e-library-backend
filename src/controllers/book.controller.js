const mongoose = require('mongoose');
const Book = require('../models/Book');

const creatableFields = [
  'title', 'author', 'description', 'content', 'isbn', 'category', 'tags',
  'coverImage', 'publishedYear', 'totalCopies', 'availableCopies'
];

const patchableFields = creatableFields.filter((field) => field !== 'availableCopies');

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isValidBookId = (id) => /^[a-fA-F0-9]{24}$/.test(id) && mongoose.isValidObjectId(id);

const validateRequestFieldTypes = (body, fields) => {
  const stringFields = ['title', 'author', 'description', 'content', 'isbn', 'category', 'coverImage'];
  const numberFields = ['publishedYear', 'totalCopies', 'availableCopies'];

  for (const field of stringFields) {
    if (fields.includes(field) && typeof body[field] !== 'string') {
      throw createError(`${field} must be a string.`, 400);
    }
  }

  for (const field of numberFields) {
    if (fields.includes(field) && (typeof body[field] !== 'number' || !Number.isFinite(body[field]))) {
      throw createError(`${field} must be a valid number.`, 400);
    }
  }

  if (fields.includes('tags') && (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string'))) {
    throw createError('tags must be an array of strings.', 400);
  }
};

const handleBookError = (error, next) => {
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    error.statusCode = 400;
  }
  if (error.code === 11000) {
    error.message = 'A book with this ISBN already exists.';
    error.statusCode = 409;
  }
  return next(error);
};

const createBook = async (req, res, next) => {
  try {
    const { title, author, description, content, isbn, category, tags, coverImage, publishedYear, totalCopies } = req.body;
    const providedFields = Object.keys(req.body).filter((field) => field !== 'availableCopies');
    const unknownFields = providedFields.filter((field) => !creatableFields.includes(field));

    if (unknownFields.length) {
      throw createError(`Unknown field(s): ${unknownFields.join(', ')}.`, 400);
    }
    if (title === undefined || author === undefined || description === undefined || totalCopies === undefined) {
      throw createError('Title, author, description, and totalCopies are required.', 400);
    }

    validateRequestFieldTypes(req.body, providedFields);
    const book = await Book.create({
      title, author, description, content, isbn, category, tags, coverImage, publishedYear, totalCopies,
      // Initial availability is derived from inventory; client input is intentionally ignored.
      availableCopies: totalCopies
    });
    return res.status(201).json({ message: 'Book created successfully.', book });
  } catch (error) {
    return handleBookError(error, next);
  }
};

const getBooks = async (req, res, next) => {
  try {
    const books = await Book.find();
    return res.status(200).json({ books });
  } catch (error) {
    return next(error);
  }
};

const getBookById = async (req, res, next) => {
  try {
    if (!isValidBookId(req.params.id)) {
      throw createError('Invalid book ID.', 400);
    }
    const book = await Book.findById(req.params.id);
    if (!book) {
      throw createError('Book not found.', 404);
    }
    return res.status(200).json({ book });
  } catch (error) {
    return handleBookError(error, next);
  }
};

const updateBook = async (req, res, next) => {
  try {
    if (!isValidBookId(req.params.id)) {
      throw createError('Invalid book ID.', 400);
    }
    const updateFields = Object.keys(req.body);
    if (Object.hasOwn(req.body, 'availableCopies')) {
      throw createError('availableCopies cannot be updated directly.', 400);
    }
    const unknownFields = updateFields.filter((field) => !patchableFields.includes(field));
    if (unknownFields.length || updateFields.length === 0) {
      throw createError(unknownFields.length ? `Unknown field(s): ${unknownFields.join(', ')}.` : 'Provide at least one field to update.', 400);
    }
    validateRequestFieldTypes(req.body, updateFields);

    const book = await Book.findById(req.params.id);
    if (!book) {
      throw createError('Book not found.', 404);
    }

    const totalCopiesChanged = Object.hasOwn(req.body, 'totalCopies') && req.body.totalCopies !== book.totalCopies;
    if (totalCopiesChanged) {
      const unavailableCopies = book.totalCopies - book.availableCopies;
      if (req.body.totalCopies < unavailableCopies) {
        throw createError('totalCopies cannot be lower than the number of unavailable copies.', 409);
      }
      // Inventory changes retain all currently unavailable copies.
      book.totalCopies = req.body.totalCopies;
      book.availableCopies = req.body.totalCopies - unavailableCopies;
    }

    for (const field of updateFields) {
      if (field !== 'totalCopies') {
        book[field] = req.body[field];
      }
    }
    await book.save();
    return res.status(200).json({ message: 'Book updated successfully.', book });
  } catch (error) {
    return handleBookError(error, next);
  }
};

const deleteBook = async (req, res, next) => {
  try {
    if (!isValidBookId(req.params.id)) {
      throw createError('Invalid book ID.', 400);
    }
    const book = await Book.findById(req.params.id);
    if (!book) {
      throw createError('Book not found.', 404);
    }
    if (book.availableCopies < book.totalCopies) {
      throw createError('Cannot delete a book with unavailable copies.', 409);
    }
    await book.deleteOne();
    return res.status(204).send();
  } catch (error) {
    return handleBookError(error, next);
  }
};

module.exports = { createBook, getBooks, getBookById, updateBook, deleteBook };
