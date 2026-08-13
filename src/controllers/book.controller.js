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

const allowedSortFields = new Set(['title', 'author', 'publishedYear', 'createdAt']);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parsePositiveInteger = (value, field, maximum) => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createError(`${field} must be a positive integer.`, 400);
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || (maximum && number > maximum)) {
    throw createError(maximum ? `${field} must be a positive integer no greater than ${maximum}.` : `${field} must be a positive integer.`, 400);
  }
  return number;
};

const parseBookListQuery = (queryParameters) => {
  const page = queryParameters.page === undefined ? 1 : parsePositiveInteger(queryParameters.page, 'page');
  const limit = queryParameters.limit === undefined ? 10 : parsePositiveInteger(queryParameters.limit, 'limit', 50);
  const sort = queryParameters.sort === undefined ? 'createdAt' : queryParameters.sort;
  const order = queryParameters.order === undefined ? 'desc' : queryParameters.order;

  if (typeof sort !== 'string' || !allowedSortFields.has(sort)) {
    throw createError('sort must be one of: title, author, publishedYear, createdAt.', 400);
  }
  if (order !== 'asc' && order !== 'desc') {
    throw createError('order must be either asc or desc.', 400);
  }

  const filter = {};
  if (queryParameters.search !== undefined) {
    if (typeof queryParameters.search !== 'string') {
      throw createError('search must be a string.', 400);
    }
    const searchPattern = new RegExp(escapeRegex(queryParameters.search), 'i');
    filter.$or = [{ title: searchPattern }, { author: searchPattern }];
  }
  if (queryParameters.category !== undefined) {
    if (typeof queryParameters.category !== 'string') {
      throw createError('category must be a string.', 400);
    }
    filter.category = new RegExp(`^${escapeRegex(queryParameters.category)}$`, 'i');
  }
  if (queryParameters.available !== undefined) {
    if (queryParameters.available === 'true') {
      filter.availableCopies = { $gt: 0 };
    } else if (queryParameters.available === 'false') {
      filter.availableCopies = 0;
    } else {
      throw createError('available must be either true or false.', 400);
    }
  }

  return { filter, page, limit, sort: { [sort]: order === 'asc' ? 1 : -1 } };
};

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
    const { filter, page, limit, sort } = parseBookListQuery(req.query);
    const skip = (page - 1) * limit;
    const [books, totalBooks] = await Promise.all([
      Book.find(filter).sort(sort).skip(skip).limit(limit),
      Book.countDocuments(filter)
    ]);
    const totalPages = Math.ceil(totalBooks / limit);
    return res.status(200).json({
      books,
      pagination: {
        page,
        limit,
        totalBooks,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    return handleBookError(error, next);
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
