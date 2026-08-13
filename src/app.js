const express = require('express');

const healthRouter = require('./routes/health.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.use('/api/health', healthRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
