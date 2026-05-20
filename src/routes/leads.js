const express = require('express');
const router = express.Router();
const { 
  receiveLead, 
  getLeadStatus, 
  updateLeadStatus,
  forceCall
} = require('../controllers/leadsController');

// Recebe lead do N8N
router.post('/', receiveLead);

// Consulta status de um lead
router.get('/:lead_id', getLeadStatus);

// Atualiza status (WON ou LOST)
router.patch('/:lead_id/status', updateLeadStatus);

// Força discagem imediata (apenas para testes)
router.post('/:lead_id/force-call', forceCall);

module.exports = router;