const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const MEETIME_API_URL = 'https://api.meetime.com.br/v2';
const MEETIME_TOKEN = process.env.MEETIME_API_KEY;

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleToken(req, res) {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Token do Google é obrigatório' });
  }

  try {
    // Verifica o token do Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    console.log(`[AUTH] Login Google: ${email}`);

    // Busca o usuário na Meetime pelo e-mail
    const response = await axios.get(`${MEETIME_API_URL}/users`, {
      headers: { Authorization: MEETIME_TOKEN }
    });

    const users = response.data.data || [];
    const meetimeUser = users.find(
      u => u.email?.toLowerCase() === email.toLowerCase() && u.active
    );

    if (!meetimeUser) {
      return res.status(403).json({
        error: 'Usuário não encontrado na Meetime. Verifique se seu e-mail está cadastrado e ativo.'
      });
    }

    return res.json({
      meetime_id: meetimeUser.id,
      name: meetimeUser.name || name,
      email: meetimeUser.email,
      picture,
      role: meetimeUser.role,
      team_id: meetimeUser.team_id,
      team_name: meetimeUser.team_name,
      is_manager: meetimeUser.role !== 'SALESMAN'
    });

  } catch (err) {
    console.error('[AUTH] Erro no login Google:', err.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { verifyGoogleToken };