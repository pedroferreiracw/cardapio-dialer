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
    interval_minutes,
    daily_goal_meetings
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
        daily_goal_meetings = COALESCE($9, daily_goal_meetings),
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
      interval_minutes,
      daily_goal_meetings
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

// Busca meta pessoal do SDR
router.get('/goal/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;

  try {
    // Busca meta pessoal do SDR
    const personal = await pool.query(
      'SELECT daily_goal_meetings FROM sdr_goals WHERE sdr_id = $1',
      [sdr_id]
    );

    // Se não tiver meta pessoal, retorna a meta padrão do gestor
    if (personal.rows.length === 0) {
      const config = await pool.query(
        'SELECT daily_goal_meetings FROM cadence_config WHERE id = 1'
      );
      return res.json({
        daily_goal_meetings: config.rows[0]?.daily_goal_meetings || 5,
        source: 'default'
      });
    }

    return res.json({
      daily_goal_meetings: personal.rows[0].daily_goal_meetings,
      source: 'personal'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Salva meta pessoal do SDR
router.put('/goal/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;
  const { daily_goal_meetings } = req.body;

  if (!daily_goal_meetings || daily_goal_meetings < 1) {
    return res.status(400).json({ error: 'Meta deve ser pelo menos 1 reunião' });
  }

  try {
    await pool.query(`
      INSERT INTO sdr_goals (sdr_id, daily_goal_meetings, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (sdr_id)
      DO UPDATE SET daily_goal_meetings = $2, updated_at = NOW()
    `, [sdr_id, daily_goal_meetings]);

    console.log(`[CONFIG] Meta do SDR ${sdr_id} atualizada para ${daily_goal_meetings} reuniões/dia`);
    return res.json({
      message: `Meta atualizada para ${daily_goal_meetings} reuniões por dia`,
      daily_goal_meetings
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Remove meta pessoal do SDR (volta para o padrão do gestor)
router.delete('/goal/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;

  try {
    await pool.query(
      'DELETE FROM sdr_goals WHERE sdr_id = $1',
      [sdr_id]
    );

    const config = await pool.query(
      'SELECT daily_goal_meetings FROM cadence_config WHERE id = 1'
    );

    return res.json({
      message: 'Meta pessoal removida — usando meta padrão do time',
      daily_goal_meetings: config.rows[0]?.daily_goal_meetings || 5,
      source: 'default'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;