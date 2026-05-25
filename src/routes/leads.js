const express = require('express');
const router = express.Router();
const { 
  receiveLead, 
  getLeadStatus, 
  updateLeadStatus
} = require('../controllers/leadsController');

// Recebe lead do N8N
router.post('/', receiveLead);

// Consulta status de um lead
router.get('/:lead_id', getLeadStatus);

// Atualiza status (WON, LOST, SCHEDULED, WRONG_NUMBER)
router.patch('/:lead_id/status', updateLeadStatus);

// Rota temporária — limpa fila de leads (remover após uso)
router.delete('/queue/clear', async (req, res) => {
  const pool = require('../config/database');
  const { secret } = req.query;

  if (secret !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    await pool.query('DELETE FROM call_attempts');
    await pool.query('DELETE FROM lead_notes');
    await pool.query('DELETE FROM leads_queue');

    res.json({ message: 'Fila limpa com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;