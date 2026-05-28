const express = require('express');
const router = express.Router();
const { 
  receiveLead, 
  getLeadStatus, 
  updateLeadStatus,
  registerOutcome,
  scheduleAttempt
} = require('../controllers/leadsController');

// Recebe lead do N8N
router.post('/', receiveLead);

// Consulta status de um lead
router.get('/:lead_id', getLeadStatus);

// Atualiza status (WON, LOST, SCHEDULED, WRONG_NUMBER)
router.patch('/:lead_id/status', updateLeadStatus);

// Registra resultado da ligação (outcome)
router.post('/:lead_id/outcome', registerOutcome);

// Agenda tentativa manual em horário específico
router.post('/:lead_id/schedule', scheduleAttempt);

module.exports = router;