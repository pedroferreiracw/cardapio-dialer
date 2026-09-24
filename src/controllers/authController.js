const { findMeetimeUserByEmail } = require('../services/meetimeUsers');

async function getUserByEmail(req, res) {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório' });
  }

  try {
    const { user, reason } = await findMeetimeUserByEmail(email);

    if (reason === 'not_found') {
      console.warn('[AUTH] Login Meetime negado: e-mail não encontrado na Meetime');
      return res.status(404).json({
        error: 'E-mail não encontrado na Meetime'
      });
    }

    if (reason === 'inactive') {
      console.warn(`[AUTH] Login Meetime negado: usuário inativo na Meetime (meetime_id ${user.id})`);
      return res.status(404).json({
        error: 'Usuário inativo na Meetime'
      });
    }

    return res.json({
      meetime_id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      team_id: user.team_id,
      team_name: user.team_name,
      is_manager: user.role !== 'SALESMAN'
    });

  } catch (err) {
    console.error('[AUTH] Erro ao buscar usuário na Meetime:', err.message);
    return res.status(500).json({ error: 'Erro ao consultar a Meetime' });
  }
}

module.exports = { getUserByEmail };