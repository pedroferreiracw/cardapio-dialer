const express = require('express');
const router = express.Router();
const { getUserByEmail } = require('../controllers/authController');
const { verifyGoogleToken } = require('../controllers/googleAuthController');

// Login com Google
router.post('/google', verifyGoogleToken);

// Busca usuário na Meetime pelo e-mail
router.get('/meetime', getUserByEmail);

module.exports = router;