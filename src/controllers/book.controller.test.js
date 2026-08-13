const assert = require('node:assert/strict');
const test = require('node:test');
const Book = require('../models/Book');
const { createBook, updateBook } = require('./book.controller');
const errorHandler = require('../middleware/errorHandler');

const BOOK_ID = '507f1f77bcf86cd799439011';

const makeResponse = () => {
  const response = {};
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
};

const makeBook = ({ totalCopies, availableCopies }) => ({
  totalCopies,
  availableCopies,
  saveCalls: 0,
  async save() {
    this.saveCalls += 1;
  }
});

const invoke = async (handler, req) => {
  const response = makeResponse();
  let nextError;
  await handler(req, response, (error) => {
    nextError = error;
  });
  return { response, nextError };
};

test('PATCH rejects direct availableCopies updates', async (t) => {
  const originalFindById = Book.findById;
  t.after(() => { Book.findById = originalFindById; });

  const { response, nextError } = await invoke(updateBook, {
    params: { id: BOOK_ID },
    body: { availableCopies: 3 }
  });

  errorHandler(nextError, {}, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /availableCopies cannot be updated directly/);
});

test('PATCH totalCopies increase preserves unavailable copies', async (t) => {
  const book = makeBook({ totalCopies: 5, availableCopies: 2 });
  const originalFindById = Book.findById;
  Book.findById = async () => book;
  t.after(() => { Book.findById = originalFindById; });

  const { response, nextError } = await invoke(updateBook, {
    params: { id: BOOK_ID },
    body: { totalCopies: 8 }
  });

  assert.equal(nextError, undefined);
  assert.equal(response.statusCode, 200);
  assert.equal(book.totalCopies, 8);
  assert.equal(book.availableCopies, 5);
  assert.equal(book.saveCalls, 1);
});

test('PATCH rejects totalCopies below unavailable copies', async (t) => {
  const book = makeBook({ totalCopies: 5, availableCopies: 2 });
  const originalFindById = Book.findById;
  Book.findById = async () => book;
  t.after(() => { Book.findById = originalFindById; });

  const { response, nextError } = await invoke(updateBook, {
    params: { id: BOOK_ID },
    body: { totalCopies: 2 }
  });

  assert.equal(response.statusCode, undefined);
  assert.equal(nextError.statusCode, 409);
  assert.match(nextError.message, /cannot be lower/);
  assert.equal(book.totalCopies, 5);
  assert.equal(book.availableCopies, 2);
  assert.equal(book.saveCalls, 0);
});

test('creation derives availableCopies from totalCopies', async (t) => {
  const originalCreate = Book.create;
  let createdBook;
  Book.create = async (book) => {
    createdBook = book;
    return book;
  };
  t.after(() => { Book.create = originalCreate; });

  const { response, nextError } = await invoke(createBook, {
    body: {
      title: 'Test title',
      author: 'Test author',
      description: 'Test description',
      totalCopies: 6,
      availableCopies: 1
    }
  });

  assert.equal(nextError, undefined);
  assert.equal(response.statusCode, 201);
  assert.equal(createdBook.totalCopies, 6);
  assert.equal(createdBook.availableCopies, 6);
});
