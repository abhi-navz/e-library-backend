const express = require('express');
const borrowingController = require('../controllers/borrowing.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/', requireAuth, borrowingController.borrowBook);
router.get('/my', requireAuth, borrowingController.getMyBorrowings);
router.patch('/:id/return', requireAuth, borrowingController.returnBook);

module.exports = router;
