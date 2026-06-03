const express = require('express');
const router = express.Router();
const { twimlResponse, statusCallback } = require('../controllers/telnyxController');

// TeXML inicial — retorna instrução de espera
router.post('/twiml', twimlResponse);
router.get('/twiml', twimlResponse);

// Recebe todos os eventos de status da chamada
router.post('/status', statusCallback);

module.exports = router;