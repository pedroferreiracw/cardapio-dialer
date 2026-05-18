 const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

// SDR ativa ou pausa o sistema
async function updateSdrStatus(req, res) {
  const { sdr_id } = req.params;
  const { status } = req.body;

  const validStatuses = ['ONLINE', 'OFFLINE', 'BUSY'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Status inválido. Use ONLINE, OFFLINE ou BUSY'
    });
  }

  try {
    const redis = await getRedisClient();

    // Salva o status no Redis com expiração de 12h
    await redis.setEx(`sdr:${sdr_id}:status`, 43200, status);
    await redis.setEx(`sdr:${sdr_id}:name`, 43200, req.body.sdr_name || sdr_id);
    await redis.setEx(`sdr:${sdr_id}:updated_at`, 43200, new Date().toISOString());

    console.log(`SDR ${sdr_id} → ${status}`);

    return res.json({
      sdr_id,
      status,
      updated_at: new Date().toISOString(),
      message: status === 'ONLINE'
        ? 'Sistema ativado — discagem iniciada'
        : status === 'OFFLINE'
        ? 'Sistema pausado — discagem interrompida'
        : 'SDR em chamada'
    });

  } catch (err) {
    console.error('Erro ao atualizar status do SDR:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Consulta o status atual de um SDR
async function getSdrStatus(req, res) {
  const { sdr_id } = req.params;

  try {
    const redis = await getRedisClient();

    const status     = await redis.get(`sdr:${sdr_id}:status`) || 'OFFLINE';
    const name       = await redis.get(`sdr:${sdr_id}:name`) || sdr_id;
    const updated_at = await redis.get(`sdr:${sdr_id}:updated_at`);

    return res.json({ sdr_id, name, status, updated_at });

  } catch (err) {
    console.error('Erro ao buscar status do SDR:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Lista status de todos os SDRs online
async function getAllSdrsStatus(req, res) {
  try {
    const redis = await getRedisClient();

    // Busca todas as chaves de status no Redis
    const keys = await redis.keys('sdr:*:status');

    const sdrs = await Promise.all(keys.map(async (key) => {
      const sdr_id     = key.split(':')[1];
      const status     = await redis.get(key);
      const name       = await redis.get(`sdr:${sdr_id}:name`) || sdr_id;
      const updated_at = await redis.get(`sdr:${sdr_id}:updated_at`);
      return { sdr_id, name, status, updated_at };
    }));

    return res.json(sdrs);

  } catch (err) {
    console.error('Erro ao listar SDRs:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

module.exports = { updateSdrStatus, getSdrStatus, getAllSdrsStatus };
