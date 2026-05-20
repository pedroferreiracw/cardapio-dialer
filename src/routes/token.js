const express = require('express');
const router = express.Router();
const { generateToken } = require('../controllers/tokenController');

router.get('/', generateToken);

module.exports = router;