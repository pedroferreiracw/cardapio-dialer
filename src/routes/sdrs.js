const express = require('express');
const router = express.Router();
const {
  updateSdrStatus,
  getSdrStatus,
  getAllSdrsStatus,
  getSdrSessionStats
} = require('../controllers/sdrsController');

// Lista todos os SDRs
router.get('/', getAllSdrsStatus);

// Tempo ativo/inativo dos SDRs — para o gestor
router.get('/sessions/stats', getSdrSessionStats);

// Status de um SDR específico
router.get('/:sdr_id', getSdrStatus);

// Atualiza status (ONLINE/OFFLINE/BUSY)
router.patch('/:sdr_id/status', updateSdrStatus);

module.exports = router;