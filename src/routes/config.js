const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Busca configuração atual
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cadence_config WHERE id = 1'
    );
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Atualiza configuração
router.put('/', async (req, res) => {
  const {
    max_attempts_per_day,
    max_days,
    business_start,
    business_end,
    lunch_start,
    lunch_end,
    timezone,
    interval_minutes
  } = req.body;

  try {
    await pool.query(`
      UPDATE cadence_config SET
        max_attempts_per_day = COALESCE($1, max_attempts_per_day),
        max_days = COALESCE($2, max_days),
        business_start = COALESCE($3, business_start),
        business_end = COALESCE($4, business_end),
        lunch_start = COALESCE($5, lunch_start),
        lunch_end = COALESCE($6, lunch_end),
        timezone = COALESCE($7, timezone),
        interval_minutes = COALESCE($8, interval_minutes),
        updated_at = NOW()
      WHERE id = 1
    `, [
      max_attempts_per_day,
      max_days,
      business_start,
      business_end,
      lunch_start,
      lunch_end,
      timezone,
      interval_minutes
    ]);

    const result = await pool.query(
      'SELECT * FROM cadence_config WHERE id = 1'
    );

    console.log('[CONFIG] Configurações de cadência atualizadas');
    return res.json({
      message: 'Configurações salvas com sucesso',
      config: result.rows[0]
    });

  } catch (err) {
    console.error('[CONFIG] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;