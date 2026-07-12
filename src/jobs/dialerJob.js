const cron = require('node-cron');
const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

// ── Trava de segurança do power dialer ────────────────────────────────
// Começa em 1 (= comporta-se como simple dialer). Só suba para 2/3 após
// validar o teste de 2 SDRs simultâneos (áudio não cruza).
const MAX_LINHAS_POR_SDR = parseInt(process.env.MAX_LINHAS_POR_SDR || '1', 10);

// Busca N leads DAQUELE SDR específico, prontos para discar agora.
// O particionamento por sdr_id garante que um SDR só disca os próprios leads.
async function getLeadsParaSdr(sdrId, limite) {
  const configResult = await pool.query(
    'SELECT interval_minutes FROM cadence_config WHERE id = 1'
  );
  const intervalMinutes = configResult.rows[0]?.interval_minutes || 30;

  const result = await pool.query(`
    SELECT lq.*
    FROM leads_queue lq
    WHERE lq.sdr_id = $1
      AND lq.status = 'PENDING'
      AND lq.status NOT IN ('WON', 'LOST', 'ARCHIVED', 'ANSWERED', 'CALLING', 'SCHEDULED', 'WRONG_NUMBER')
      AND (
        lq.last_attempt_at IS NULL
        OR lq.last_attempt_at <= NOW() - ($2 || ' minutes')::INTERVAL
      )
      AND lq.total_attempts < lq.max_attempts
    ORDER BY
      lq.created_at DESC,
      lq.last_attempt_at ASC NULLS FIRST
    LIMIT $3
  `, [sdrId, intervalMinutes, limite]);

  return result.rows;
}

async function getOnlineSdrs() {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('sdr:*:status');
    const onlineSdrs = [];

    for (const key of keys) {
      const status = await redis.get(key);
      if (status === 'ONLINE') {
        const sdrId = key.split(':')[1];
        onlineSdrs.push(sdrId);
      }
    }
    return onlineSdrs;
  } catch (err) {
    console.error('[DIALER] Erro ao buscar SDRs online:', err.message);
    return [];
  }
}

// Dispara UMA ligação para um lead. Marca CALLING e registra a tentativa.
async function processLead(lead) {
  console.log(`[DIALER] Discando para ${lead.lead_name} (${lead.lead_phone}) → SDR: ${lead.sdr_name}`);

  try {
    const { initiateCall } = require('../services/telnyxService');
    const callControlId = await initiateCall(
      lead.id,
      lead.lead_phone,
      lead.sdr_id,   // ← dono do lead: amarra a transferência ao SDR certo
      lead.lead_name
    );

    await pool.query(`
      UPDATE leads_queue
      SET status = 'CALLING',
          attempts_today = attempts_today + 1,
          total_attempts = total_attempts + 1,
          last_attempt_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [lead.id]);

    await pool.query(`
      INSERT INTO call_attempts
        (lead_queue_id, lead_id, sdr_id, phone_dialed, telnyx_call_control_id, status)
      VALUES ($1, $2, $3, $4, $5, 'initiated')
    `, [lead.id, lead.lead_id, lead.sdr_id, lead.lead_phone, callControlId]);

    console.log(`[DIALER] Ligação iniciada — CallControlId: ${callControlId}`);

  } catch (err) {
    await pool.query(`
      UPDATE leads_queue SET status = 'PENDING', updated_at = NOW()
      WHERE id = $1
    `, [lead.id]);
    console.error(`[DIALER] Erro ao discar para ${lead.lead_name}:`, err.message);
  }
}

// Processa um SDR: se ele estiver livre (sem lock), dispara até N linhas em paralelo.
async function processarSdr(sdrId) {
  const redis = await getRedisClient();

  // Se o SDR já tem um lock ativo, ele está em/entrando numa chamada. Não disca mais.
  const emChamada = await redis.get(`sdr:${sdrId}:lock`);
  if (emChamada) {
    return;
  }

  // Confirma que está ONLINE (não BUSY nem offline)
  const status = await redis.get(`sdr:${sdrId}:status`);
  if (status !== 'ONLINE') {
    return;
  }

  // Quantas linhas disparar nesta leva
  const linhas = MAX_LINHAS_POR_SDR;
  const leads = await getLeadsParaSdr(sdrId, linhas);
  if (leads.length === 0) return;

  console.log(`[PD] SDR ${sdrId}: disparando ${leads.length} linha(s) em paralelo`);

  // Dispara todas as linhas do SDR ao mesmo tempo.
  // Quem atender primeiro vence o lock (no telnyxController) e fica com o SDR;
  // os demais são abandonados e devolvidos à fila. Nunca vão para outro SDR.
  await Promise.all(leads.map(lead => processLead(lead)));
}

async function startDialerJob() {
  console.log(`Power dialer iniciado — loop de 5s | MAX_LINHAS_POR_SDR=${MAX_LINHAS_POR_SDR}`);

  // Destrava leads presos em ANSWERED/CALLING há mais de 1h (mantido do original)
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await pool.query(`
        UPDATE leads_queue
        SET status = 'PENDING', updated_at = NOW()
        WHERE status IN ('ANSWERED', 'CALLING')
          AND updated_at <= NOW() - INTERVAL '1 hour'
      `);
      if (result.rowCount > 0) {
        console.log(`[DIALER] ${result.rowCount} lead(s) liberados de status travado`);
      }
    } catch (err) {
      console.error('[DIALER] Erro ao liberar leads travados:', err.message);
    }
  });

  // ── Loop principal do power dialer — a cada 5 segundos ──────────────
  let rodando = false; // trava de reentrância: evita sobreposição de execuções
  setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const onlineSdrs = await getOnlineSdrs();
      if (onlineSdrs.length === 0) return;

      // Processa cada SDR de forma independente — cada um só disca seus próprios leads
      await Promise.all(onlineSdrs.map(sdrId => processarSdr(sdrId)));
    } catch (err) {
      console.error('[PD] Erro no loop:', err.message);
    } finally {
      rodando = false;
    }
  }, 5000);
}

module.exports = { startDialerJob };