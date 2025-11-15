const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth.cjs');
const { validateRequest, schemas } = require('../middleware/validation');
const { authLimiter } = require('../middleware/rateLimiter');

// Dynamic import for ES module
let upload;
(async () => {
  const uploadModule = await import('../middleware/upload.js');
  upload = uploadModule.upload;
})();

router.post('/register', authLimiter, validateRequest(schemas.register), authController.register);
router.post('/login', authLimiter, validateRequest(schemas.login), authController.login);
router.post('/logout', authController.logout);
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/profile', authenticateToken, authController.updateProfile);

// Upload avatar - requires authentication and multer middleware
router.post('/upload-avatar', authenticateToken, async (req, res, next) => {
  let uploadMiddleware = upload;
  if (!uploadMiddleware) {
    const uploadModule = await import('../middleware/upload.js');
    uploadMiddleware = uploadModule.upload;
    upload = uploadMiddleware; // Update global for next time
  }
  uploadMiddleware.single('avatar')(req, res, next);
}, authController.uploadAvatar);

module.exports = router;