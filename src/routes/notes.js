const express = require('express');
const router = express.Router();
const { saveNotes, getNotes } = require('../controllers/notesController');

// Salva ou atualiza anotações
router.post('/', saveNotes);

// Busca anotações de um lead por SDR
router.get('/:lead_id/:sdr_id', getNotes);

module.exports = router;