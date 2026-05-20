const twilio = require('twilio');
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

function generateToken(req, res) {
  const { sdr_id, sdr_name } = req.query;

  if (!sdr_id) {
    return res.status(400).json({ error: 'sdr_id é obrigatório' });
  }

  try {
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: `sdr_${sdr_id}` }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true
    });

    token.addGrant(voiceGrant);

    return res.json({
      token: token.toJwt(),
      identity: `sdr_${sdr_id}`
    });

  } catch (err) {
    console.error('Erro ao gerar token:', err.message);
    return res.status(500).json({ error: 'Erro ao gerar token' });
  }
}

module.exports = { generateToken };