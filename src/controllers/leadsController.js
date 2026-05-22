const pool = require('../config/database');
const { generateFullCadence } = require('../services/scheduleService');

async function receiveLead(req, res) {
  const {
    lead_id,
    lead_name,
    lead_phone,
    lead_email,
    lead_company,
    sdr_id,
    sdr_name,
    cadence,
    prospection_id
  } = req.body;

  if (!lead_id || !lead_phone || !sdr_id) {
    return res.status(400).json({ 
      error: 'Campos obrigatórios: lead_id, lead_phone, sdr_id' 
    });
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM leads_queue 
       WHERE lead_id = $1 AND status NOT IN ('WON', 'LOST', 'ARCHIVED')`,
      [lead_id]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({ 
        message: 'Lead já está na fila de discagem',
        lead_queue_id: existing.rows[0].id
      });
    }

    await pool.query(`
      INSERT INTO sdrs (id, name) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET name = $2
    `, [sdr_id, sdr_name]);

    const result = await pool.query(`
      INSERT INTO leads_queue 
        (lead_id, lead_name, lead_phone, lead_email, lead_company,
         sdr_id, sdr_name, cadence, prospection_id, status, next_attempt_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', NOW())
      RETURNING id
    `, [lead_id, lead_name, lead_phone, lead_email, lead_company,
        sdr_id, sdr_name, cadence, prospection_id]);

    const leadQueueId = result.rows[0].id;
    await generateFullCadence(leadQueueId);

    return res.status(201).json({
      message: 'Lead adicionado à fila com sucesso',
      lead_queue_id: leadQueueId
    });

  } catch (err) {
    console.error('Erro ao receber lead:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

async function getLeadStatus(req, res) {
  const { lead_id } = req.params;

  try {
    const result = await pool.query(`
      SELECT lq.*, 
        COUNT(ca.id) as total_call_attempts,
        MAX(ca.attempted_at) as last_call_at
      FROM leads_queue lq
      LEFT JOIN call_attempts ca ON ca.lead_queue_id = lq.id
      WHERE lq.lead_id = $1
      GROUP BY lq.id
      ORDER BY lq.created_at DESC
      LIMIT 1
    `, [lead_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Erro ao buscar lead:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

async function updateLeadStatus(req, res) {
  const { lead_id } = req.params;
  const { status } = req.body;

  const validStatuses = ['WON', 'LOST', 'SCHEDULED', 'WRONG_NUMBER'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ 
      error: 'Status inválido. Use WON, LOST, SCHEDULED ou WRONG_NUMBER' 
    });
  }

  try {
    await pool.query(`
      UPDATE leads_queue 
      SET status = $1, updated_at = NOW()
      WHERE lead_id = $2 AND status NOT IN ('WON', 'LOST', 'ARCHIVED')
    `, [status, lead_id]);

    await pool.query(`
      UPDATE daily_schedules ds
      SET status = 'SKIPPED'
      FROM leads_queue lq
      WHERE ds.lead_queue_id = lq.id
        AND lq.lead_id = $1
        AND ds.scheduled_at > NOW()
        AND ds.status = 'PENDING'
    `, [lead_id]);

    return res.json({ 
      message: `Lead marcado como ${status} com sucesso` 
    });

  } catch (err) {
    console.error('Erro ao atualizar lead:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

module.exports = { receiveLead, getLeadStatus, updateLeadStatus };