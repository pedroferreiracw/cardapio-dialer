const express = require('express');
const router = express.Router();
const { getUserByEmail } = require('../controllers/authController');

// Busca usuário na Meetime pelo e-mail do Google
router.get('/meetime', getUserByEmail);

module.exports = router;