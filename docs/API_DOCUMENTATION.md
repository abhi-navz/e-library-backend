# E-Library Backend API Documentation

Base URL: `/api`

For local development, the complete base URL is typically:

http://localhost:3000/api

### Examples:
GET http://localhost:3000/api/books

All JSON errors use the form:

```json
{ "message": "A human-readable error message." }
```

Object IDs are MongoDB ObjectId strings. Dates are serialized as ISO date strings. Authentication uses the HTTP-only `token` cookie set by login.

## Endpoint index

There are 20 registered endpoints:

- Health: 1
- Authentication: 5
- Books: 6
- Borrowing: 3
- Admin users: 4
- Admin overdue borrowing: 1

## Health

### GET `/api/health`

Purpose: process health check.

Authentication/role: none.

Success `200`:

```json
{ "status": "ok", "message": "E-Library backend is running" }
```

## Authentication

### POST `/api/auth/register`

Purpose: create a public user account.

Authentication/role: none.

Body:

```json
{ "name": "Asha Reader", "email": "asha@example.com", "password": "strong-password" }
```

`name`, `email`, and `password` are required. Email is trimmed/lowercased. A supplied `role` is not used; registration always creates `role: "user"`.

Success `201`:

```json
{
  "message": "User registered successfully.",
  "user": { "id": "...", "name": "Asha Reader", "email": "asha@example.com", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." }
}
```

Errors: `400` missing/invalid details; `409` duplicate email.

### POST `/api/auth/bootstrap-admin`

Purpose: create the initial administrator from server configuration.

Authentication/role: no existing admin required; no request authentication.

Body: ignored. Do not send credentials in the body.

The server requires `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`, validates the configured credentials, normalizes the email, and creates an admin only when no admin currently exists. If an admin already exists, the endpoint returns `409`.

Success `201`:

```json
{
  "message": "Administrator bootstrapped successfully.",
  "user": { "id": "...", "name": "Administrator", "email": "admin@example.com", "role": "admin", "isActive": true, "createdAt": "...", "updatedAt": "..." }
}
```

Errors: `503` missing/invalid bootstrap configuration; `409` if any admin already exists. Passwords and hashes are never returned.

### POST `/api/auth/login`

Purpose: authenticate an active user.

Authentication/role: none.

Body:

```json
{ "email": "asha@example.com", "password": "strong-password" }
```

Success `200`: sets an HTTP-only `token` cookie and returns:

```json
{
  "message": "Login successful.",
  "user": { "id": "...", "name": "Asha Reader", "email": "asha@example.com", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." }
}
```

Cookie settings: HTTP-only, `sameSite: lax`, `secure` in production, seven-day max age. Errors: `400` invalid/missing fields; `401` invalid credentials; `403` inactive account; `500` missing JWT configuration.

### POST `/api/auth/logout`

Purpose: clear the authentication cookie.

Authentication/role: none (the route does not require a valid session).

Body: none.

Success `200`:

```json
{ "message": "Logout successful." }
```

### GET `/api/auth/me`

Purpose: return the current authenticated user.

Authentication: required. Role: any active user.

Success `200`:

```json
{ "user": { "id": "...", "name": "Asha Reader", "email": "asha@example.com", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." } }
```

Error: `401` missing, invalid, expired, inactive, or unknown session.

## Books

### GET `/api/books`

Purpose: list catalog books with search, filtering, pagination, and sorting.

Authentication/role: none.

Query parameters:

- `search`: case-insensitive title or author search
- `category`: case-insensitive exact category match
- `available`: `true` for copies available, `false` for zero available copies
- `page`: positive integer, default `1`
- `limit`: positive integer, default `10`, maximum `50`
- `sort`: `title`, `author`, `publishedYear`, or `createdAt`; default `createdAt`
- `order`: `asc` or `desc`; default `desc`

Example: `GET /api/books?search=clean&category=Programming&available=true&page=1&limit=10&sort=title&order=asc`

Success `200`:

```json
{
  "books": [{
    "_id": "...", "title": "Clean Code", "author": "Robert C. Martin",
    "description": "...", "content": "...", "aiSummary": null,
    "category": "Programming", "tags": ["software"], "coverImage": "...",
    "publishedYear": 2008, "totalCopies": 3, "availableCopies": 2,
    "createdAt": "...", "updatedAt": "..."
  }],
  "pagination": { "page": 1, "limit": 10, "totalBooks": 1, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false }
}
```

Errors: `400` invalid query values.

### GET `/api/books/:id`

Purpose: retrieve one book.

Authentication/role: none.

Success `200`: `{ "book": { ... } }` with the Book model fields.

Errors: `400` invalid ObjectId; `404` book not found.

### POST `/api/books`

Purpose: create a book.

Authentication: required. Role: `admin`.

Body fields: `title`, `author`, `description`, `content`, `isbn`, `category`, `tags`, `coverImage`, `publishedYear`, and `totalCopies`. Title, author, description, and totalCopies are required. `availableCopies` is ignored if supplied; unknown fields are rejected.

Example:

```json
{ "title": "Clean Code", "author": "Robert C. Martin", "description": "Software craftsmanship guidance.", "totalCopies": 3, "category": "Programming" }
```

Success `201`: `{ "message": "Book created successfully.", "book": { ... } }`. `availableCopies` is initialized to `totalCopies`; `aiSummary` defaults to `null`.

Errors: `400` invalid/missing fields; `409` duplicate ISBN; `401`/`403` authentication/role failure.

### PATCH `/api/books/:id`

Purpose: update an existing book.

Authentication: required. Role: `admin`.

Allowed fields: `title`, `author`, `description`, `content`, `isbn`, `category`, `tags`, `coverImage`, `publishedYear`, `totalCopies`. `availableCopies` and `aiSummary` cannot be updated directly.

Example: `{ "description": "Updated description." }`

Success `200`: `{ "message": "Book updated successfully.", "book": { ... } }`.

Changing title, author, description, or content clears `aiSummary`. Changing totalCopies preserves unavailable copies and recalculates availability; it cannot reduce totalCopies below unavailable copies. Errors: `400` invalid ID/fields; `404` missing book; `409` duplicate ISBN or invalid inventory change; `401`/`403` authorization failure.

### DELETE `/api/books/:id`

Purpose: delete a book.

Authentication: required. Role: `admin`.

Body: none.

Success `204` with no response body. Errors: `400` invalid ID; `404` missing book; `409` if any copies are unavailable; `401`/`403` authorization failure.

### GET `/api/books/:id/summary`

Purpose: generate or retrieve a cached AI summary.

Authentication: required. Role: any active user.

Query/body: none. The only client input is the URL book ID.

Success `200` (first generation):

```json
{ "bookId": "...", "summary": "Concise generated summary.", "cached": false }
```

Cached success:

```json
{ "bookId": "...", "summary": "Concise generated summary.", "cached": true }
```

The service sends title, author, and preferably non-empty content, otherwise description, to UserFacet. Source material is truncated to 12,000 characters. Inventory, ISBN, category, user, borrowing data, client prompts, and model choices are not sent. The system instruction requires an accurate concise summary without invented facts or preambles. The provider response must contain a non-empty `choices[0].message.content` string.

Errors: `400` invalid ID or insufficient source material; `404` missing book; `429` provider rate limit; `502` provider auth, malformed response, or unavailable service; `503` missing AI configuration/network failure; `504` provider timeout; `401` missing/invalid user session.

## Borrowing

### POST `/api/borrowings`

Purpose: borrow an available book.

Authentication: required. Role: any active user.

Body:

```json
{ "bookId": "..." }
```

Only `bookId` is accepted. The server sets `user`, `borrowedAt`, `status: "borrowed"`, and `dueDate` exactly 14 days after borrowing.

Success `201`:

```json
{ "message": "Book borrowed successfully.", "borrowing": { "_id": "...", "user": "...", "book": { "title": "...", "author": "...", "coverImage": "...", "category": "..." }, "borrowedAt": "...", "dueDate": "...", "returnedAt": null, "status": "borrowed", "createdAt": "...", "updatedAt": "..." } }
```

The operation uses a transaction and conditional atomic decrement. Errors: `400` missing/malformed ID or extra fields; `404` missing book; `409` no copies or existing active borrowing; `401` unauthenticated.

### GET `/api/borrowings/my`

Purpose: list only the authenticated user’s borrowing history.

Authentication: required. Role: any active user.

Query parameter: optional `status` of `borrowed`, `returned`, or `overdue`. With no status, all records are returned. Results are sorted newest `borrowedAt` first. `overdue` is dynamic: `status` must be `borrowed` and `dueDate` must be earlier than query time.

Success `200`:

```json
{ "borrowings": [{ "_id": "...", "user": "...", "book": { "title": "...", "author": "...", "coverImage": "...", "category": "..." }, "borrowedAt": "...", "dueDate": "...", "returnedAt": null, "status": "borrowed", "createdAt": "...", "updatedAt": "..." }] }
```

`userId` is not accepted for selecting another user. Errors: `400` invalid status or userId query; `401` unauthenticated.

### PATCH `/api/borrowings/:id/return`

Purpose: return the authenticated user’s active borrowing.

Authentication: required. Role: any active user.

Body: none; request fields are rejected.

Success `200`:

```json
{ "message": "Book returned successfully.", "borrowing": { "status": "returned", "returnedAt": "...", "book": { "title": "...", "author": "...", "coverImage": "...", "category": "..." }, "...": "..." } }
```

The transaction sets `returnedAt`, changes status to `returned`, and atomically increments availability only below totalCopies. Errors: `400` malformed ID or body; `403` another user’s borrowing; `404` missing borrowing; `409` already returned or inventory inconsistency; `401` unauthenticated.

## Admin user management

All routes in this section require `requireAuth` and `requireRole('admin')`.

### POST `/api/admin/users`

Purpose: create a user or administrator.

Body fields only: `name`, `email`, `password`, `role`. Role must be `user` or `admin`; email is normalized. Unknown fields are rejected.

Success `201`:

```json
{ "message": "User created successfully.", "user": { "id": "...", "name": "...", "email": "...", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." } }
```

The User model hashes the password with bcrypt before save. Errors: `400` invalid/missing fields; `409` duplicate email; `401`/`403` authorization failure.

### GET `/api/admin/users`

Purpose: paginated user list without passwords.

Query: `page` default `1`; `limit` default `10`, maximum `50`.

Success `200`:

```json
{ "users": [{ "id": "...", "name": "...", "email": "...", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." }], "pagination": { "page": 1, "limit": 10, "totalUsers": 1, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false } }
```

Errors: `400` invalid pagination; `401`/`403` authorization failure.

### GET `/api/admin/users/:id`

Purpose: retrieve one user without password data.

Body/query: none.

Success `200`: `{ "user": { "id": "...", "name": "...", "email": "...", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." } }`.

Errors: `400` malformed ID; `404` missing user; `401`/`403` authorization failure.

### PATCH `/api/admin/users/:id`

Purpose: update account metadata.

Allowed body fields: `name`, `email`, `role`, `isActive`. Password changes and unknown fields are rejected. Email is normalized; role must be `user` or `admin`; `isActive` must be boolean.

Success `200`: `{ "message": "User updated successfully.", "user": { ... } }`.

An active administrator cannot be demoted or deactivated if they are the last active admin, including when modifying themselves. Errors: `400` invalid ID/fields; `404` missing user; `409` duplicate email or last-admin violation; `401`/`403` authorization failure.

## Admin overdue borrowing

### GET `/api/admin/borrowings/overdue`

Purpose: paginated administrator view of currently overdue borrowings.

Authentication: required. Role: `admin`.

Query: `page` default `1`; `limit` default `10`, maximum `50`.

Filtering is performed in MongoDB with `status: "borrowed"` and `dueDate < now`; returnedAt is not used. Results sort by ascending dueDate, oldest first. User population includes only `name`, `email`, `role`, `isActive`, and timestamps. Book population includes title, author, cover image, and category.

Success `200`:

```json
{ "borrowings": [{ "_id": "...", "user": { "_id": "...", "name": "...", "email": "...", "role": "user", "isActive": true, "createdAt": "...", "updatedAt": "..." }, "book": { "_id": "...", "title": "...", "author": "...", "coverImage": "...", "category": "..." }, "borrowedAt": "...", "dueDate": "...", "returnedAt": null, "status": "borrowed", "createdAt": "...", "updatedAt": "..." }], "pagination": { "page": 1, "limit": 10, "totalBorrowings": 1, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false } }
```

Errors: `400` invalid pagination; `401` unauthenticated; `403` non-admin.

## Models and persistence details

### User

Fields: `name`, unique normalized `email`, bcrypt-hashed `password` (excluded by default), `role` (`user`/`admin`), `isActive`, and timestamps. The JSON transform removes password and `__v`. `requireAuth` rejects missing, invalid, expired, unknown, or inactive users.

### Book

Fields: title, author, description, optional content, `aiSummary`, optional ISBN/category/tags/coverImage/publishedYear, `totalCopies`, `availableCopies`, and timestamps. Validation enforces integer copy counts, minimum total copies of 1, non-negative availability, and availability no greater than total copies.

### Borrowing

Fields: referenced `user` and `book`, `borrowedAt`, `dueDate`, nullable `returnedAt`, status (`borrowed`/`returned`), and timestamps. Indexes are:

- Partial unique `{ user: 1, book: 1 }` for active `borrowed` records
- `{ user: 1, borrowedAt: -1 }`
- `{ book: 1, status: 1 }`
- `{ status: 1, dueDate: 1 }` for overdue queries

## Business and security details

Borrowing and returning run in MongoDB transactions. Borrowing conditionally decrements only when availability is greater than zero; returning conditionally increments only when availability is below total copies. This protects inventory from negative/excess values and concurrent last-copy requests. The partial unique index plus transaction handling prevents duplicate active loans.

Admin user creation and bootstrap use the User model’s bcrypt save hook. User-facing and admin responses use sanitized user projections; no password or hash is returned. There is no password-change endpoint in the current API.

## AI provider integration

The AI service calls `${AI_API_BASE_URL}/v1/chat/completions` with a bearer token from `AI_API_TOKEN`, a 15-second timeout, and a concise system/user message pair. No provider SDK is used and no model override is sent.

Sent data: book title, author, and content when non-empty; otherwise description. Content/description source material is trimmed and capped at 12,000 characters.

Deliberately not sent: totalCopies, availableCopies, ISBN, category, tags, cover image, users, borrowings, passwords, prompts, or client instructions.

The response must contain a non-empty `choices[0].message.content`. Only that text is persisted in `aiSummary`; the provider response object is not stored. A populated cache returns `cached: true` without a provider call. Admin changes to title, author, description, or content set `aiSummary` to null. Inventory and unrelated metadata changes do not invalidate it.

## Error handling

Controllers assign status codes for validation, authorization, not-found, conflict, provider, and timeout cases. The final middleware returns only `{ message }`; stack traces, tokens, passwords, and raw provider authorization details are not sent to clients.

## Tests

```bash
npm test
```

The script runs `node --test`. The repository currently contains `src/controllers/book.controller.test.js`, a controller-level suite covering book validation, inventory derivation/protection, search/filtering, pagination, and sorting. External Atlas/AI checks used during development are temporary and are not committed test files.
