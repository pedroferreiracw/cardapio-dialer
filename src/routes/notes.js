const express = require('express');
const router = express.Router();
const { saveNotes, getNotes, syncMeetime } = require('../controllers/notesController');

// Salva ou atualiza anotações
router.post('/', saveNotes);

// Busca anotações de um lead por SDR
router.get('/:lead_id/:sdr_id', getNotes);

// Sincroniza anotações com a Meetime
router.post('/:lead_id/sync-meetime', syncMeetime);

module.exports = router;