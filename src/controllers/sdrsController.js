const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

// SDR ativa ou pausa o sistema
async function updateSdrStatus(req, res) {
  const { sdr_id } = req.params;
  const { status, sdr_name } = req.body;

  const validStatuses = ['ONLINE', 'OFFLINE', 'BUSY'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Status inválido. Use ONLINE, OFFLINE ou BUSY'
    });
  }

  try {
    const redis = await getRedisClient();
    const resolvedName = sdr_name || sdr_id;

    // Salva o status no Redis com expiração de 12h
    await redis.setEx(`sdr:${sdr_id}:status`, 43200, status);
    await redis.setEx(`sdr:${sdr_id}:name`, 43200, resolvedName);
    await redis.setEx(`sdr:${sdr_id}:updated_at`, 43200, new Date().toISOString());

    // Rastreia sessões para tempo ativo/inativo
    if (status === 'ONLINE') {
      // Inicia nova sessão
      await pool.query(`
        INSERT INTO sdr_sessions (sdr_id, sdr_name, started_at)
        VALUES ($1, $2, NOW())
      `, [sdr_id, resolvedName]);

      console.log(`SDR ${sdr_id} → ONLINE — sessão iniciada`);

    } else if (status === 'OFFLINE') {
      // Encerra sessão ativa
      await pool.query(`
        UPDATE sdr_sessions
        SET ended_at = NOW(),
            duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INT
        WHERE sdr_id = $1
          AND ended_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
      `, [sdr_id]);

      console.log(`SDR ${sdr_id} → OFFLINE — sessão encerrada`);
    }

    // Garante que o nome está salvo na tabela sdrs
    await pool.query(`
      INSERT INTO sdrs (id, name) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET name = $2
    `, [sdr_id, resolvedName]);

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
    const updated_at = await redis.get(`sdr:${sdr_id}:updated_at`);

    // Busca nome da tabela sdrs (fonte mais confiável)
    const sdrResult = await pool.query(
      'SELECT name FROM sdrs WHERE id = $1', [sdr_id]
    );
    const name = sdrResult.rows[0]?.name 
      || await redis.get(`sdr:${sdr_id}:name`) 
      || sdr_id;

    return res.json({ sdr_id, name, status, updated_at });

  } catch (err) {
    console.error('Erro ao buscar status do SDR:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Lista status de todos os SDRs
async function getAllSdrsStatus(req, res) {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('sdr:*:status');

    const sdrs = await Promise.all(keys.map(async (key) => {
      const sdr_id     = key.split(':')[1];
      const status     = await redis.get(key);
      const updated_at = await redis.get(`sdr:${sdr_id}:updated_at`);

      // Busca nome da tabela sdrs primeiro
      const sdrResult = await pool.query(
        'SELECT name FROM sdrs WHERE id = $1', [sdr_id]
      );
      const name = sdrResult.rows[0]?.name
        || await redis.get(`sdr:${sdr_id}:name`)
        || sdr_id;

      return { sdr_id, name, status, updated_at };
    }));

    return res.json(sdrs);

  } catch (err) {
    console.error('Erro ao listar SDRs:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Tempo ativo/inativo dos SDRs — para o gestor
async function getSdrSessionStats(req, res) {
  const { start_date, end_date } = req.query;
  const start = start_date || new Date().toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(`
      SELECT
        sdr_id,
        sdr_name,
        COUNT(*) as total_sessoes,
        SUM(duration_seconds) as total_ativo_segundos,
        AVG(duration_seconds) as media_sessao_segundos,
        MIN(started_at) as primeiro_acesso,
        MAX(ended_at) as ultimo_acesso
      FROM sdr_sessions
      WHERE started_at >= $1::date
        AND started_at < ($2::date + INTERVAL '1 day')
        AND ended_at IS NOT NULL
      GROUP BY sdr_id, sdr_name
      ORDER BY total_ativo_segundos DESC NULLS LAST
    `, [start, end]);

    // Formata os segundos em horas e minutos
    const formatted = result.rows.map(row => ({
      sdr_id: row.sdr_id,
      sdr_name: row.sdr_name,
      total_sessoes: parseInt(row.total_sessoes),
      total_ativo_segundos: parseInt(row.total_ativo_segundos || 0),
      total_ativo_formatado: formatDuration(parseInt(row.total_ativo_segundos || 0)),
      media_sessao_formatado: formatDuration(parseInt(row.media_sessao_segundos || 0)),
      primeiro_acesso: row.primeiro_acesso,
      ultimo_acesso: row.ultimo_acesso
    }));

    return res.json({ period: { start, end }, sessoes: formatted });

  } catch (err) {
    console.error('Erro ao buscar sessões:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

module.exports = { 
  updateSdrStatus, 
  getSdrStatus, 
  getAllSdrsStatus,
  getSdrSessionStats
};