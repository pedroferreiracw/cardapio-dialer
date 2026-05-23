const axios = require('axios');

const MEETIME_API_URL = 'https://api.meetime.com.br/v2';
const MEETIME_TOKEN = process.env.MEETIME_API_KEY;

async function getUserByEmail(req, res) {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório' });
  }

  try {
    const response = await axios.get(`${MEETIME_API_URL}/users`, {
      headers: { Authorization: MEETIME_TOKEN }
    });

    const users = response.data.data || [];

    const user = users.find(
      u => u.email?.toLowerCase() === email.toLowerCase() && u.active
    );

    if (!user) {
      return res.status(404).json({ 
        error: 'Usuário não encontrado na Meetime ou inativo' 
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