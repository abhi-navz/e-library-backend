const assert = require('node:assert/strict');
const test = require('node:test');
const Book = require('../models/Book');
const { createBook, getBooks, updateBook } = require('./book.controller');
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

const mockBookListQuery = (t, books, totalBooks) => {
  const originalFind = Book.find;
  const originalCountDocuments = Book.countDocuments;
  const state = {};
  Book.find = (filter) => {
    state.filter = filter;
    return {
      sort(sort) { state.sort = sort; return this; },
      skip(skip) { state.skip = skip; return this; },
      limit(limit) { state.limit = limit; return Promise.resolve(books); }
    };
  };
  Book.countDocuments = async (filter) => {
    state.countFilter = filter;
    return totalBooks;
  };
  t.after(() => {
    Book.find = originalFind;
    Book.countDocuments = originalCountDocuments;
  });
  return state;
};

test('GET books builds database filters, sorting, and pagination metadata', async (t) => {
  const books = [{ title: 'Clean Code' }];
  const state = mockBookListQuery(t, books, 12);
  const { response, nextError } = await invoke(getBooks, {
    query: { search: 'clean', category: 'programming', available: 'true', page: '2', limit: '5', sort: 'title', order: 'asc' }
  });

  assert.equal(nextError, undefined);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.books, books);
  assert.deepEqual(response.body.pagination, { page: 2, limit: 5, totalBooks: 12, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
  assert.equal(state.filter.$or[0].title.test('Clean Architecture'), true);
  assert.equal(state.filter.$or[1].author.test('Robert C. Martin'), false);
  assert.equal(state.filter.category.test('Programming'), true);
  assert.deepEqual(state.filter.availableCopies, { $gt: 0 });
  assert.deepEqual(state.sort, { title: 1 });
  assert.equal(state.skip, 5);
  assert.equal(state.limit, 5);
  assert.deepEqual(state.countFilter, state.filter);
});

test('GET books escapes search regex special characters and supports unavailable filtering', async (t) => {
  const state = mockBookListQuery(t, [], 0);
  const { response, nextError } = await invoke(getBooks, {
    query: { search: 'C++ (2nd)', available: 'false' }
  });

  assert.equal(nextError, undefined);
  assert.equal(state.filter.$or[0].title.test('C++ (2nd) Edition'), true);
  assert.equal(state.filter.$or[0].title.test('Cxx 2nd Edition'), false);
  assert.equal(state.filter.availableCopies, 0);
  assert.deepEqual(response.body.pagination, { page: 1, limit: 10, totalBooks: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  assert.deepEqual(state.sort, { createdAt: -1 });
});

for (const [sortField, order, expectedSort] of [
  ['title', 'desc', { title: -1 }],
  ['author', 'asc', { author: 1 }],
  ['publishedYear', 'desc', { publishedYear: -1 }],
  ['createdAt', 'asc', { createdAt: 1 }]
]) {
  test(`GET books supports sorting by ${sortField} ${order}`, async (t) => {
    const state = mockBookListQuery(t, [], 0);
    const { nextError } = await invoke(getBooks, { query: { sort: sortField, order } });
    assert.equal(nextError, undefined);
    assert.deepEqual(state.sort, expectedSort);
  });
}

for (const [name, query, message] of [
  ['invalid page', { page: '0' }, /page must be a positive integer/],
  ['negative page', { page: '-1' }, /page must be a positive integer/],
  ['non-numeric page', { page: 'abc' }, /page must be a positive integer/],
  ['invalid limit', { limit: '0' }, /limit must be a positive integer/],
  ['limit above maximum', { limit: '51' }, /limit must be a positive integer no greater than 50/],
  ['non-numeric limit', { limit: 'abc' }, /limit must be a positive integer/],
  ['invalid availability', { available: 'yes' }, /available must be either true or false/],
  ['invalid sort field', { sort: 'password' }, /sort must be one of/],
  ['invalid order', { order: 'random' }, /order must be either asc or desc/]
]) {
  test(`GET books rejects ${name}`, async () => {
    const { nextError } = await invoke(getBooks, { query });
    assert.equal(nextError.statusCode, 400);
    assert.match(nextError.message, message);
  });
}
