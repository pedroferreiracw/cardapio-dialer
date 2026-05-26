const pool = require('../config/database');
const { sendAnnotationsToMeetime } = require('./meetimeController');

async function saveNotes(req, res) {
  const { lead_id, sdr_id, notes } = req.body;

  if (!lead_id || !sdr_id) {
    return res.status(400).json({ error: 'lead_id e sdr_id são obrigatórios' });
  }

  try {
    await pool.query(`
      INSERT INTO lead_notes (lead_id, sdr_id, notes, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (lead_id, sdr_id)
      DO UPDATE SET notes = $3, updated_at = NOW()
    `, [lead_id, sdr_id, notes || '']);

    return res.json({ message: 'Anotações salvas com sucesso' });

  } catch (err) {
    console.error('[NOTES] Erro ao salvar anotações:', err.message);
    return res.status(500).json({ error: 'Erro ao salvar anotações' });
  }
}

async function getNotes(req, res) {
  const { lead_id, sdr_id } = req.params;

  try {
    const result = await pool.query(`
      SELECT notes, updated_at
      FROM lead_notes
      WHERE lead_id = $1 AND sdr_id = $2
    `, [lead_id, sdr_id]);

    return res.json({
      notes: result.rows[0]?.notes || '',
      updated_at: result.rows[0]?.updated_at || null
    });

  } catch (err) {
    console.error('[NOTES] Erro ao buscar anotações:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar anotações' });
  }
}

// Sincroniza anotações com a Meetime
async function syncMeetime(req, res) {
  const { lead_id } = req.params;
  const { notes } = req.body;

  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: 'Anotações não podem ser vazias' });
  }

  try {
    const success = await sendAnnotationsToMeetime(lead_id, notes);

    if (success) {
      console.log(`[NOTES] Anotações sincronizadas com Meetime — lead ${lead_id}`);
      return res.json({ message: 'Anotações enviadas para a Meetime com sucesso' });
    } else {
      return res.status(500).json({ error: 'Erro ao enviar para a Meetime' });
    }

  } catch (err) {
    console.error('[NOTES] Erro ao sincronizar com Meetime:', err.message);
    return res.status(500).json({ error: 'Erro ao sincronizar com Meetime' });
  }
}

module.exports = { saveNotes, getNotes, syncMeetime };