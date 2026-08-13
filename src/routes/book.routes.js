const express = require('express');
const bookController = require('../controllers/book.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', bookController.getBooks);
router.get('/:id', bookController.getBookById);
router.post('/', requireAuth, requireRole('admin'), bookController.createBook);
router.patch('/:id', requireAuth, requireRole('admin'), bookController.updateBook);
router.delete('/:id', requireAuth, requireRole('admin'), bookController.deleteBook);

module.exports = router;
