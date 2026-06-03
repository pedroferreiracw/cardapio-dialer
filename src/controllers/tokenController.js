const { getSdrToken } = require('../services/telnyxService');

async function generateToken(req, res) {
  const { sdr_id } = req.query;

  if (!sdr_id) {
    return res.status(400).json({ error: 'sdr_id é obrigatório' });
  }

  try {
    const token = await getSdrToken(sdr_id);

    return res.json({
      token,
      identity: `sdr_${sdr_id}`
    });

  } catch (err) {
    console.error('[TOKEN] Erro ao gerar token Telnyx:', err.message);
    return res.status(500).json({ error: 'Erro ao gerar token WebRTC' });
  }
}

module.exports = { generateToken };