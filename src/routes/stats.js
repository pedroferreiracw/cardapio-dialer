const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

// Stats de um SDR específico com filtro de data
router.get('/sdr/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;
  const { start_date, end_date } = req.query;

  const start = start_date || new Date().toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];

  try {
    const ligacoes = await pool.query(`
      SELECT COUNT(*) as total
      FROM call_attempts
      WHERE sdr_id = $1
        AND attempted_at >= $2::date
        AND attempted_at < ($3::date + INTERVAL '1 day')
    `, [sdr_id, start, end]);

    const atendidos = await pool.query(`
      SELECT COUNT(*) as total
      FROM leads_queue
      WHERE sdr_id = $1
        AND answered_at IS NOT NULL
        AND answered_at >= $2::date
        AND answered_at < ($3::date + INTERVAL '1 day')
    `, [sdr_id, start, end]);

    const reunioes = await pool.query(`
      SELECT COUNT(*) as total
      FROM call_outcomes
      WHERE sdr_id = $1
        AND outcome IN ('SCHEDULED', 'WON')
        AND created_at >= $2::date
        AND created_at < ($3::date + INTERVAL '1 day')
    `, [sdr_id, start, end]);

    const totalLigacoes = parseInt(ligacoes.rows[0].total);
    const totalAtendidos = parseInt(atendidos.rows[0].total);
    const totalReunioes = parseInt(reunioes.rows[0].total);
    const taxa = totalLigacoes > 0 
      ? Math.round((totalAtendidos / totalLigacoes) * 100) 
      : 0;

    // Histórico de outcomes do SDR
    const historico = await pool.query(`
      SELECT outcome, lead_name, lead_company, created_at
      FROM call_outcomes
      WHERE sdr_id = $1
        AND created_at >= $2::date
        AND created_at < ($3::date + INTERVAL '1 day')
      ORDER BY created_at DESC
      LIMIT 50
    `, [sdr_id, start, end]);

    return res.json({
      sdr_id,
      period: { start, end },
      ligacoes: totalLigacoes,
      atendidos: totalAtendidos,
      reunioes: totalReunioes,
      taxa,
      historico: historico.rows
    });

  } catch (err) {
    console.error('[STATS] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Stats gerais para o gestor
router.get('/general', async (req, res) => {
  const { start_date, end_date } = req.query;
  const start = start_date || new Date().toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];

  try {
    const redis = await getRedisClient();

    // Busca todos os SDRs com status no Redis
    const keys = await redis.keys('sdr:*:status');
    const sdrsData = [];

    for (const key of keys) {
      const sdr_id = key.split(':')[1];
      const status = await redis.get(key);
      const name = await redis.get(`sdr:${sdr_id}:name`);

      // Busca nome real da tabela sdrs se não tiver no Redis
      let sdrName = name || sdr_id;
      if (!name || name === sdr_id) {
        const sdrResult = await pool.query(
          'SELECT name FROM sdrs WHERE id = $1', [sdr_id]
        );
        if (sdrResult.rows.length > 0) {
          sdrName = sdrResult.rows[0].name;
        }
      }

      const ligacoes = await pool.query(`
        SELECT COUNT(*) as total FROM call_attempts
        WHERE sdr_id = $1
          AND attempted_at >= $2::date
          AND attempted_at < ($3::date + INTERVAL '1 day')
      `, [sdr_id, start, end]);

      const atendidos = await pool.query(`
        SELECT COUNT(*) as total
        FROM leads_queue
        WHERE sdr_id = $1
          AND answered_at IS NOT NULL
          AND answered_at >= $2::date
          AND answered_at < ($3::date + INTERVAL '1 day')
        `, [sdr_id, start, end]);

      const reunioes = await pool.query(`
        SELECT COUNT(*) as total FROM call_outcomes
        WHERE sdr_id = $1 AND outcome IN ('SCHEDULED', 'WON')
          AND created_at >= $2::date
          AND created_at < ($3::date + INTERVAL '1 day')
      `, [sdr_id, start, end]);

      const totalLig = parseInt(ligacoes.rows[0].total);
      const totalAt = parseInt(atendidos.rows[0].total);

      sdrsData.push({
        sdr_id,
        name: sdrName,
        status: status || 'OFFLINE',
        ligacoes: totalLig,
        atendidos: totalAt,
        reunioes: parseInt(reunioes.rows[0].total),
        taxa: totalLig > 0 ? Math.round((totalAt / totalLig) * 100) : 0
      });
    }

    // Totais gerais
    const totalLigacoes = sdrsData.reduce((s, x) => s + x.ligacoes, 0);
    const totalAtendidos = sdrsData.reduce((s, x) => s + x.atendidos, 0);
    const totalReunioes = sdrsData.reduce((s, x) => s + x.reunioes, 0);
    const taxaMedia = totalLigacoes > 0 
      ? Math.round((totalAtendidos / totalLigacoes) * 100) 
      : 0;

    // Atividade recente
    const atividades = await pool.query(`
      SELECT sdr_name, lead_name, lead_company, outcome, created_at
      FROM call_outcomes
      WHERE created_at >= $1::date
        AND created_at < ($2::date + INTERVAL '1 day')
      ORDER BY created_at DESC
      LIMIT 20
    `, [start, end]);

    return res.json({
      period: { start, end },
      totais: {
        sdrs_ativos: sdrsData.filter(s => s.status === 'ONLINE').length,
        ligacoes: totalLigacoes,
        atendidos: totalAtendidos,
        reunioes: totalReunioes,
        taxa_media: taxaMedia
      },
      sdrs: sdrsData.sort((a, b) => {
        const order = { ONLINE: 0, BUSY: 1, OFFLINE: 2 };
        return (order[a.status] || 2) - (order[b.status] || 2);
      }),
      atividades: atividades.rows
    });

  } catch (err) {
    console.error('[STATS] Erro geral:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Fila real do SDR
router.get('/queue/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 200, 500); // padrão 200, teto 500

  try {
    const result = await pool.query(`
      SELECT 
        lead_id, lead_name, lead_company, lead_phone,
        cadence, status, total_attempts, max_attempts,
        last_attempt_at, created_at
      FROM leads_queue
      WHERE sdr_id = $1
        AND status NOT IN ('WON', 'LOST', 'ARCHIVED')
      ORDER BY 
        CASE WHEN last_attempt_at IS NULL THEN 0 ELSE 1 END,
        last_attempt_at ASC
      LIMIT $2
    `, [sdr_id, limit]);

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PAINEL AO VIVO DO SDR — polling a cada 3s no frontend
// Mostra: discando agora, em atendimento, fila aguardando, métricas do dia
// ─────────────────────────────────────────────────────────────────
router.get('/live/:sdr_id', async (req, res) => {
  const { sdr_id } = req.params;
  const hoje = new Date().toISOString().split('T')[0];

  try {
    // Leads sendo discados NESTE momento (status CALLING)
    const discando = await pool.query(`
      SELECT lead_id, lead_name, lead_company, lead_phone,
             cadence, total_attempts, max_attempts, last_attempt_at
      FROM leads_queue
      WHERE sdr_id = $1 AND status = 'CALLING'
      ORDER BY last_attempt_at DESC
    `, [sdr_id]);

    // Lead em atendimento agora (atendeu e está com o SDR)
    const emAtendimento = await pool.query(`
      SELECT lead_id, lead_name, lead_company, lead_phone,
             cadence, total_attempts, answered_at
      FROM leads_queue
      WHERE sdr_id = $1 AND status = 'ANSWERED'
      ORDER BY answered_at DESC
      LIMIT 1
    `, [sdr_id]);

    // Próximos da fila (aguardando)
    const fila = await pool.query(`
      SELECT lead_id, lead_name, lead_company, lead_phone,
             cadence, total_attempts, max_attempts, last_attempt_at
      FROM leads_queue
      WHERE sdr_id = $1 AND status = 'PENDING'
      ORDER BY
        CASE WHEN last_attempt_at IS NULL THEN 0 ELSE 1 END,
        last_attempt_at ASC
      LIMIT 50
    `, [sdr_id]);

    // Métricas do dia — incluindo abandono
    const metricas = await pool.query(`
      SELECT
        COUNT(*) AS ligacoes,
        COUNT(*) FILTER (WHERE abandoned = TRUE) AS abandonadas
      FROM call_attempts
      WHERE sdr_id = $1
        AND attempted_at >= $2::date
        AND attempted_at < ($2::date + INTERVAL '1 day')
    `, [sdr_id, hoje]);

    const atendidosDia = await pool.query(`
      SELECT COUNT(*) AS total
      FROM leads_queue
      WHERE sdr_id = $1
        AND answered_at IS NOT NULL
        AND answered_at >= $2::date
        AND answered_at < ($2::date + INTERVAL '1 day')
    `, [sdr_id, hoje]);

    const ligacoes = parseInt(metricas.rows[0].ligacoes);
    const abandonadas = parseInt(metricas.rows[0].abandonadas);
    const atendidos = parseInt(atendidosDia.rows[0].total);

    return res.json({
      sdr_id,
      discando_agora: discando.rows,
      em_atendimento: emAtendimento.rows[0] || null,
      fila_aguardando: fila.rows,
      metricas_dia: {
        ligacoes,
        atendidos,
        abandonadas,
        taxa_atendimento: ligacoes > 0 ? Math.round((atendidos / ligacoes) * 100) : 0,
        taxa_abandono: ligacoes > 0 ? Math.round((abandonadas / ligacoes) * 100) : 0
      }
    });

  } catch (err) {
    console.error('[LIVE SDR] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PAINEL AO VIVO DO GESTOR — todos os SDRs discando ao mesmo tempo
// ─────────────────────────────────────────────────────────────────
router.get('/live-geral', async (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];

  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('sdr:*:status');
    const sdrs = [];

    for (const key of keys) {
      const sdr_id = key.split(':')[1];
      const status = await redis.get(key);

      // Nome do SDR
      let sdrName = sdr_id;
      const sdrResult = await pool.query('SELECT name FROM sdrs WHERE id = $1', [sdr_id]);
      if (sdrResult.rows.length > 0) sdrName = sdrResult.rows[0].name;

      // Quem esse SDR está discando agora
      const discando = await pool.query(`
        SELECT lead_name, lead_company, lead_phone, total_attempts
        FROM leads_queue
        WHERE sdr_id = $1 AND status = 'CALLING'
        ORDER BY last_attempt_at DESC
      `, [sdr_id]);

      // Lead em atendimento
      const emAtendimento = await pool.query(`
        SELECT lead_name, lead_company, lead_phone
        FROM leads_queue
        WHERE sdr_id = $1 AND status = 'ANSWERED'
        ORDER BY answered_at DESC
        LIMIT 1
      `, [sdr_id]);

      // Métricas do dia do SDR
      const met = await pool.query(`
        SELECT
          COUNT(*) AS ligacoes,
          COUNT(*) FILTER (WHERE abandoned = TRUE) AS abandonadas
        FROM call_attempts
        WHERE sdr_id = $1
          AND attempted_at >= $2::date
          AND attempted_at < ($2::date + INTERVAL '1 day')
      `, [sdr_id, hoje]);

      const at = await pool.query(`
        SELECT COUNT(*) AS total FROM leads_queue
        WHERE sdr_id = $1 AND answered_at IS NOT NULL
          AND answered_at >= $2::date
          AND answered_at < ($2::date + INTERVAL '1 day')
      `, [sdr_id, hoje]);

      const ligacoes = parseInt(met.rows[0].ligacoes);
      const abandonadas = parseInt(met.rows[0].abandonadas);
      const atendidos = parseInt(at.rows[0].total);

      sdrs.push({
        sdr_id,
        name: sdrName,
        status: status || 'OFFLINE',
        discando_agora: discando.rows,
        em_atendimento: emAtendimento.rows[0] || null,
        ligacoes,
        atendidos,
        abandonadas,
        taxa_abandono: ligacoes > 0 ? Math.round((abandonadas / ligacoes) * 100) : 0
      });
    }

    // Agregados gerais
    const totalLig = sdrs.reduce((s, x) => s + x.ligacoes, 0);
    const totalAband = sdrs.reduce((s, x) => s + x.abandonadas, 0);
    const totalAt = sdrs.reduce((s, x) => s + x.atendidos, 0);

    return res.json({
      totais: {
        sdrs_online: sdrs.filter(s => s.status === 'ONLINE').length,
        sdrs_em_ligacao: sdrs.filter(s => s.status === 'BUSY').length,
        ligacoes: totalLig,
        atendidos: totalAt,
        abandonadas: totalAband,
        taxa_abandono_geral: totalLig > 0 ? Math.round((totalAband / totalLig) * 100) : 0
      },
      sdrs: sdrs.sort((a, b) => {
        const order = { BUSY: 0, ONLINE: 1, OFFLINE: 2 };
        return (order[a.status] || 2) - (order[b.status] || 2);
      })
    });

  } catch (err) {
    console.error('[LIVE GERAL] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;