const { OAuth2Client } = require('google-auth-library');
const { findMeetimeUserByEmail } = require('../services/meetimeUsers');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

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
    const { user: meetimeUser, reason } = await findMeetimeUserByEmail(email);

    if (reason === 'not_found') {
      console.warn('[AUTH] Login Google negado: e-mail não encontrado na Meetime');
      return res.status(403).json({
        error: 'E-mail não encontrado na Meetime. Verifique se seu e-mail está cadastrado.'
      });
    }

    if (reason === 'inactive') {
      console.warn(`[AUTH] Login Google negado: usuário inativo na Meetime (meetime_id ${meetimeUser.id})`);
      return res.status(403).json({
        error: 'Usuário inativo na Meetime. Peça ao gestor para reativar seu acesso.'
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