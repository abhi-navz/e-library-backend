const express = require('express');
const cookieParser = require('cookie-parser');

const healthRouter = require('./routes/health.routes');
const authRouter = require('./routes/auth.routes');
const bookRouter = require('./routes/book.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/books', bookRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
