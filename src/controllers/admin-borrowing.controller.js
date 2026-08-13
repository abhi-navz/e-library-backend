const Borrowing = require('../models/Borrowing');

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

const getOverdueBorrowings = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const now = new Date();
    const filter = { status: 'borrowed', dueDate: { $lt: now } };
    const skip = (page - 1) * limit;
    const [borrowings, totalBorrowings] = await Promise.all([
      Borrowing.find(filter)
        .populate('user', 'name email role isActive createdAt updatedAt')
        .populate('book', 'title author coverImage category')
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(limit),
      Borrowing.countDocuments(filter)
    ]);
    const totalPages = Math.ceil(totalBorrowings / limit);
    return res.status(200).json({
      borrowings,
      pagination: {
        page,
        limit,
        totalBorrowings,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getOverdueBorrowings };
