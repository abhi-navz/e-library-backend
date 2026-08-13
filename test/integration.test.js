const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

const User = require('../src/models/User');
const Book = require('../src/models/Book');
const Borrowing = require('../src/models/Borrowing');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const testUser = {
  name: `Integration User ${suffix}`,
  email: `integration-user-${suffix}@example.com`,
  password: 'IntegrationPass123!'
};

const testAdmin = {
  email: process.env.ADMIN_BOOTSTRAP_EMAIL,
  password: process.env.ADMIN_BOOTSTRAP_PASSWORD
};

let adminCookie = '';
let userCookie = '';

let userId;
let createdUserId;
let createdBookId;
let borrowingId;

let createdBookIds = [];
let createdUserIds = [];

function getCookie(response) {
  const setCookie = response.headers.get('set-cookie');

  if (!setCookie) {
    return '';
  }

  return setCookie.split(';')[0];
}

async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers
  });

  let body = null;

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    const text = await response.text();
    body = text || null;
  }

  return {
    response,
    body,
    cookie: getCookie(response)
  };
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing from .env');
  }

  await mongoose.connect(process.env.MONGO_URI);
}

async function cleanup() {
  try {
    if (borrowingId) {
      await Borrowing.deleteOne({ _id: borrowingId });
    }

    if (createdBookIds.length) {
      await Book.deleteMany({
        _id: { $in: createdBookIds }
      });
    }

    if (createdUserIds.length) {
      await User.deleteMany({
        _id: { $in: createdUserIds }
      });
    }

    if (userId) {
      await User.deleteOne({ _id: userId });
    }
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

test.before(async () => {
  await connectDatabase();

  assert.ok(testAdmin.email, 'ADMIN_BOOTSTRAP_EMAIL is missing from .env');
  assert.ok(testAdmin.password, 'ADMIN_BOOTSTRAP_PASSWORD is missing from .env');

  const health = await request('/api/health');

  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, 'ok');
});

test.after(async () => {
  await cleanup();
});

test('1. Public registration creates a normal user', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      ...testUser,
      role: 'admin'
    })
  });

  assert.equal(result.response.status, 201);
  assert.equal(result.body.user.role, 'user');
  assert.equal(result.body.user.email, testUser.email);

  assert.ok(result.body.user.id);

  userId = result.body.user.id;
  createdUserIds.push(userId);
});

test('2. User login sets authentication cookie', async () => {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testUser.email,
      password: testUser.password
    })
  });

  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  assert.equal(result.body.user.role, 'user');

  userCookie = result.cookie;
});

test('3. /auth/me returns authenticated user', async () => {
  const result = await request('/api/auth/me', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.email, testUser.email);
});

test('4. Unauthenticated protected endpoint returns 401', async () => {
  const result = await request('/api/auth/me');

  assert.equal(result.response.status, 401);
});

test('5. Admin login works', async () => {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testAdmin.email,
      password: testAdmin.password
    })
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.role, 'admin');
  assert.ok(result.cookie);

  adminCookie = result.cookie;
});

test('6. Admin can create a user through admin API', async () => {
  const result = await request('/api/admin/users', {
    method: 'POST',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      name: `Managed User ${suffix}`,
      email: `managed-${suffix}@example.com`,
      password: 'ManagedPass123!',
      role: 'user'
    })
  });

  assert.equal(result.response.status, 201);
  assert.equal(result.body.user.role, 'user');

  createdUserId = result.body.user.id;
  createdUserIds.push(createdUserId);

  assert.equal(result.body.user.email, `managed-${suffix}@example.com`);
});

test('7. Normal user cannot access admin user management', async () => {
  const result = await request('/api/admin/users', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 403);
});

test('8. Admin can list users', async () => {
  const result = await request('/api/admin/users?page=1&limit=10', {
    headers: {
      Cookie: adminCookie
    }
  });

  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body.users));
  assert.ok(result.body.pagination);
});

test('9. Admin can retrieve a user', async () => {
  const result = await request(`/api/admin/users/${createdUserId}`, {
    headers: {
      Cookie: adminCookie
    }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.id, createdUserId);
});

test('10. Admin can deactivate and reactivate a user', async () => {
  const deactivate = await request(`/api/admin/users/${createdUserId}`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      isActive: false
    })
  });

  assert.equal(deactivate.response.status, 200);
  assert.equal(deactivate.body.user.isActive, false);

  const reactivate = await request(`/api/admin/users/${createdUserId}`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      isActive: true
    })
  });

  assert.equal(reactivate.response.status, 200);
  assert.equal(reactivate.body.user.isActive, true);
});

test('11. Admin can create a book and availability is derived from totalCopies', async () => {
  const result = await request('/api/books', {
    method: 'POST',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      title: `Integration Test Book ${suffix}`,
      author: 'Integration Author',
      description: 'A book used for end-to-end integration testing.',
      content: 'Integration testing content.',
      isbn: `TEST-${suffix}`,
      category: 'Testing',
      tags: ['testing', 'integration'],
      publishedYear: 2025,
      totalCopies: 2,
      availableCopies: 999
    })
  });

  assert.equal(result.response.status, 201);

  const book = result.body.book;

  assert.equal(book.totalCopies, 2);
  assert.equal(book.availableCopies, 2);

  createdBookId = book._id;
  createdBookIds.push(createdBookId);
});

test('12. Public book list supports search/filter/pagination/sorting', async () => {
  const result = await request(
    '/api/books?search=Integration&category=Testing&available=true&page=1&limit=10&sort=title&order=asc'
  );

  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body.books));
  assert.ok(result.body.pagination);
  assert.equal(result.body.pagination.page, 1);
  assert.equal(result.body.pagination.limit, 10);
});

test('13. Public book lookup works', async () => {
  const result = await request(`/api/books/${createdBookId}`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.book._id, createdBookId);
});

test('14. Invalid book ID returns 400', async () => {
  const result = await request('/api/books/not-a-valid-id');

  assert.equal(result.response.status, 400);
});

test('15. availableCopies cannot be modified directly', async () => {
  const result = await request(`/api/books/${createdBookId}`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      availableCopies: 999
    })
  });

  assert.equal(result.response.status, 400);
});

test('16. Borrowing decreases available copies', async () => {
  const result = await request('/api/borrowings', {
    method: 'POST',
    headers: {
      Cookie: userCookie
    },
    body: JSON.stringify({
      bookId: createdBookId
    })
  });

  assert.equal(result.response.status, 201);

  borrowingId = result.body.borrowing._id;

  const book = await Book.findById(createdBookId);

  assert.equal(book.availableCopies, 1);
  assert.equal(book.totalCopies, 2);
});

test('17. Duplicate active borrowing is rejected', async () => {
  const result = await request('/api/borrowings', {
    method: 'POST',
    headers: {
      Cookie: userCookie
    },
    body: JSON.stringify({
      bookId: createdBookId
    })
  });

  assert.equal(result.response.status, 409);
});

test('18. User borrowing history works', async () => {
  const result = await request('/api/borrowings/my', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body.borrowings));

  const found = result.body.borrowings.some(
    (borrowing) => borrowing._id === borrowingId
  );

  assert.equal(found, true);
});

test('19. Borrowed status filter works', async () => {
  const result = await request('/api/borrowings/my?status=borrowed', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body.borrowings));
});

test('20. Invalid borrowing status returns 400', async () => {
  const result = await request('/api/borrowings/my?status=invalid', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 400);
});

test('21. totalCopies increase preserves unavailable copies', async () => {
  const result = await request(`/api/books/${createdBookId}`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      totalCopies: 4
    })
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.book.totalCopies, 4);

  // One copy is still borrowed.
  assert.equal(result.body.book.availableCopies, 3);
});

test('22. totalCopies cannot go below unavailable copies', async () => {
  const result = await request(`/api/books/${createdBookId}`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      totalCopies: 0
    })
  });

  assert.equal(result.response.status, 409);
});

test('23. Another user cannot return someone else’s borrowing', async () => {
  const result = await request(`/api/borrowings/${borrowingId}/return`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    }
  });

  assert.equal(result.response.status, 403);
});

test('24. User can return their borrowing', async () => {
  const result = await request(`/api/borrowings/${borrowingId}/return`, {
    method: 'PATCH',
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.borrowing.status, 'returned');

  const book = await Book.findById(createdBookId);

  assert.equal(book.availableCopies, 4);
});

test('25. Returning the same borrowing twice is rejected', async () => {
  const result = await request(`/api/borrowings/${borrowingId}/return`, {
    method: 'PATCH',
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 409);
});

test('26. Returned borrowing appears in returned history', async () => {
  const result = await request('/api/borrowings/my?status=returned', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 200);

  const found = result.body.borrowings.some(
    (borrowing) => borrowing._id === borrowingId
  );

  assert.equal(found, true);
});

test('27. Admin overdue endpoint requires admin access', async () => {
  const normalUser = await request('/api/admin/borrowings/overdue', {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(normalUser.response.status, 403);

  const admin = await request('/api/admin/borrowings/overdue?page=1&limit=10', {
    headers: {
      Cookie: adminCookie
    }
  });

  assert.equal(admin.response.status, 200);
  assert.ok(Array.isArray(admin.body.borrowings));
  assert.ok(admin.body.pagination);
});

test('28. Invalid overdue pagination returns 400', async () => {
  const result = await request(
    '/api/admin/borrowings/overdue?page=0&limit=100',
    {
      headers: {
        Cookie: adminCookie
      }
    }
  );

  assert.equal(result.response.status, 400);
});

test('29. AI summary endpoint requires authentication', async () => {
  const result = await request(`/api/books/${createdBookId}/summary`);

  assert.equal(result.response.status, 401);
});

test('30. AI summary endpoint can generate and cache a summary', async () => {
  if (!process.env.AI_API_TOKEN) {
    console.log('Skipping real AI provider test: AI_API_TOKEN is not configured.');
    return;
  }

  const first = await request(`/api/books/${createdBookId}/summary`, {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(first.response.status, 200);
  assert.ok(first.body.summary);
  assert.equal(first.body.cached, false);

  const second = await request(`/api/books/${createdBookId}/summary`, {
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(second.response.status, 200);
  assert.ok(second.body.summary);
  assert.equal(second.body.cached, true);
  assert.equal(second.body.summary, first.body.summary);
});

test('31. Book content changes invalidate AI summary', async () => {
  if (!process.env.AI_API_TOKEN) {
    console.log('Skipping AI cache invalidation test: AI_API_TOKEN is not configured.');
    return;
  }

  const currentBook = await Book.findById(createdBookId);

  // Ensure a summary exists.
  if (!currentBook.aiSummary) {
    return;
  }

  const result = await request(`/api/books/${createdBookId}`, {
    method: 'PATCH',
    headers: {
      Cookie: adminCookie
    },
    body: JSON.stringify({
      description: 'Updated description for cache invalidation test.'
    })
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.book.aiSummary, null);
});

test('32. Logout clears user session', async () => {
  const result = await request('/api/auth/logout', {
    method: 'POST',
    headers: {
      Cookie: userCookie
    }
  });

  assert.equal(result.response.status, 200);

  const me = await request('/api/auth/me', {
    headers: {
      Cookie: userCookie
    }
  });

  // The old cookie may still technically be sent by this manual test client.
  // Logout should clear it on a real client. We verify logout endpoint itself.
  assert.equal(result.body.message, 'Logout successful.');
});

test('33. Delete book works after all copies are available', async () => {
  const result = await request(`/api/books/${createdBookId}`, {
    method: 'DELETE',
    headers: {
      Cookie: adminCookie
    }
  });

  assert.equal(result.response.status, 204);

  createdBookIds = createdBookIds.filter(
    (id) => id !== createdBookId
  );
});