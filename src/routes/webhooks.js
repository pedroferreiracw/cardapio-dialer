const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.post('/meetime', async (req, res) => {
  const { event, prospection } = req.body;

  console.log(`[WEBHOOK] Meetime evento: ${event}`);

  try {
    if (event === 'LEAD.WON' || event === 'LEAD.LOST') {
      const leadId = String(prospection?.lead?.id);

      if (!leadId) {
        return res.sendStatus(200);
      }

      // Remove o lead da fila do discador
      await pool.query(`
        UPDATE leads_queue
        SET status = $1, updated_at = NOW()
        WHERE lead_id = $2
          AND status NOT IN ('WON', 'LOST', 'ARCHIVED')
      `, [event === 'LEAD.WON' ? 'WON' : 'LOST', leadId]);

      console.log(`[WEBHOOK] Lead ${leadId} marcado como ${event} — removido da fila`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
    res.sendStatus(500);
  }
});

module.exports = router;