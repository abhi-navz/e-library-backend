
const express = require('express');
const adminUserController = require('../controllers/admin-user.controller');
const adminBorrowingController = require('../controllers/admin-borrowing.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();
const requireAdmin = [requireAuth, requireRole('admin')];

router.post('/users', requireAdmin, adminUserController.createAdminUser);
router.get('/users', requireAdmin, adminUserController.listUsers);
router.get('/users/:id', requireAdmin, adminUserController.getUser);
router.patch('/users/:id', requireAdmin, adminUserController.updateUser);
router.get('/borrowings/overdue', requireAdmin, adminBorrowingController.getOverdueBorrowings);

module.exports = router;
