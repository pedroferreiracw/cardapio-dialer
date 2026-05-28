const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const pool = require('../config/database');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Retorna a chave pública para o frontend
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Salva a subscription do SDR
router.post('/subscribe', async (req, res) => {
  const { subscription, sdr_id } = req.body;

  if (!subscription || !sdr_id) {
    return res.status(400).json({ error: 'subscription e sdr_id são obrigatórios' });
  }

  try {
    await pool.query(`
      INSERT INTO push_subscriptions (sdr_id, subscription, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (sdr_id)
      DO UPDATE SET subscription = $2, updated_at = NOW()
    `, [sdr_id, JSON.stringify(subscription)]);

    console.log(`[PUSH] SDR ${sdr_id} registrou subscription`);
    return res.json({ message: 'Subscription salva com sucesso' });

  } catch (err) {
    console.error('[PUSH] Erro ao salvar subscription:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Remove subscription ao desativar o sistema
router.delete('/unsubscribe/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;

  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE sdr_id = $1',
      [sdr_id]
    );
    return res.json({ message: 'Subscription removida' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Envia push para um SDR específico
async function sendPushToSdr(sdrId, payload) {
  try {
    const result = await pool.query(
      'SELECT subscription FROM push_subscriptions WHERE sdr_id = $1',
      [sdrId]
    );

    if (result.rows.length === 0) return false;

    const subscription = JSON.parse(result.rows[0].subscription);

    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );

    console.log(`[PUSH] Notificação enviada para SDR ${sdrId}`);
    return true;

  } catch (err) {
    console.error(`[PUSH] Erro ao enviar para SDR ${sdrId}:`, err.message);
    // Remove subscription inválida
    if (err.statusCode === 410) {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE sdr_id = $1',
        [sdrId]
      );
    }
    return false;
  }
}

module.exports = { router, sendPushToSdr };