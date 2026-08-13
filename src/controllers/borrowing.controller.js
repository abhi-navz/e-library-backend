const mongoose = require('mongoose');
const Book = require('../models/Book');
const Borrowing = require('../models/Borrowing');

const BORROWING_BODY_FIELDS = ['bookId'];
const BOOK_POPULATION = 'title author coverImage category';

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isValidObjectId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

const hasOnlyFields = (object, allowedFields) => (
  object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).every((field) => allowedFields.includes(field))
);

const populateBook = (borrowing) => Borrowing.findById(borrowing._id)
  .populate('book', BOOK_POPULATION);

const borrowBook = async (req, res, next) => {
  let session;

  try {
    if (!hasOnlyFields(req.body, BORROWING_BODY_FIELDS) || !req.body.bookId) {
      throw createError('Please provide only a bookId.', 400);
    }

    const { bookId } = req.body;
    if (!isValidObjectId(bookId)) {
      throw createError('Please provide a valid book ID.', 400);
    }

    const borrowedAt = new Date();
    const dueDate = new Date(borrowedAt.getTime() + (14 * 24 * 60 * 60 * 1000));
    let borrowing;

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const existingBorrowing = await Borrowing.findOne({
        user: req.user._id,
        book: bookId,
        status: 'borrowed'
      }).session(session);

      if (existingBorrowing) {
        throw createError('You already have an active borrowing for this book.', 409);
      }

      const book = await Book.findOneAndUpdate(
        { _id: bookId, availableCopies: { $gt: 0 } },
        { $inc: { availableCopies: -1 } },
        { returnDocument: 'after', session }
      );

      if (!book) {
        const bookExists = await Book.exists({ _id: bookId }).session(session);
        if (!bookExists) {
          throw createError('Book not found.', 404);
        }
        throw createError('No copies of this book are currently available.', 409);
      }

      [borrowing] = await Borrowing.create([{
        user: req.user._id,
        book: book._id,
        borrowedAt,
        dueDate
      }], { session });
    });

    const populatedBorrowing = await populateBook(borrowing);
    return res.status(201).json({ message: 'Book borrowed successfully.', borrowing: populatedBorrowing });
  } catch (error) {
    if (error.code === 11000) {
      error.message = 'You already have an active borrowing for this book.';
      error.statusCode = 409;
    }
    return next(error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

const returnBook = async (req, res, next) => {
  let session;

  try {
    if (!isValidObjectId(req.params.id)) {
      throw createError('Please provide a valid borrowing ID.', 400);
    }
    if (!hasOnlyFields(req.body, [])) {
      throw createError('Return requests cannot contain request fields.', 400);
    }

    let returnedBorrowing;
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const borrowing = await Borrowing.findById(req.params.id).session(session);
      if (!borrowing) {
        throw createError('Borrowing not found.', 404);
      }
      if (!borrowing.user.equals(req.user._id)) {
        throw createError('You are not authorized to return this borrowing.', 403);
      }

      returnedBorrowing = await Borrowing.findOneAndUpdate(
        { _id: borrowing._id, user: req.user._id, status: 'borrowed' },
        { $set: { status: 'returned', returnedAt: new Date() } },
        { returnDocument: 'after', session }
      );

      if (!returnedBorrowing) {
        throw createError('This borrowing has already been returned.', 409);
      }

      const book = await Book.findOneAndUpdate(
        {
          _id: returnedBorrowing.book,
          $expr: { $lt: ['$availableCopies', '$totalCopies'] }
        },
        { $inc: { availableCopies: 1 } },
        { returnDocument: 'after', session }
      );

      if (!book) {
        throw createError('Book inventory cannot be increased for this return.', 409);
      }
    });

    const populatedBorrowing = await populateBook(returnedBorrowing);
    return res.status(200).json({ message: 'Book returned successfully.', borrowing: populatedBorrowing });
  } catch (error) {
    return next(error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

const getMyBorrowings = async (req, res, next) => {
  try {
    if (Object.hasOwn(req.query, 'userId')) {
      throw createError('Borrowing history is only available for the authenticated user.', 400);
    }

    const borrowings = await Borrowing.find({ user: req.user._id })
      .populate('book', BOOK_POPULATION)
      .sort({ borrowedAt: -1 });

    return res.status(200).json({ borrowings });
  } catch (error) {
    return next(error);
  }
};

module.exports = { borrowBook, returnBook, getMyBorrowings };
