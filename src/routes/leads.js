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

// Força discagem imediata via POST (apenas para testes)
router.post('/:lead_id/force-call', forceCall);

// Rota temporária para forçar discagem via GET
router.get('/:lead_id/force-now', async (req, res) => {
  const { lead_id } = req.params;
  const pool = require('../config/database');
  
  try {
    await pool.query(`
      UPDATE daily_schedules
      SET scheduled_at = NOW() - INTERVAL '1 minute'
      WHERE id = (
        SELECT ds.id FROM daily_schedules ds
        JOIN leads_queue lq ON lq.id = ds.lead_queue_id
        WHERE lq.lead_id = $1
          AND ds.status = 'PENDING'
        ORDER BY ds.scheduled_at ASC
        LIMIT 1
      )
    `, [lead_id]);

    await pool.query(`
      UPDATE leads_queue SET status = 'PENDING', updated_at = NOW()
      WHERE lead_id = $1
    `, [lead_id]);

    res.json({ message: 'Discagem forçada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;