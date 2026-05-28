const cron = require('node-cron');
const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

async function getLeadsDueNow(onlineSdrs) {
  // Busca intervalo configurado pelo gestor
  const configResult = await pool.query(
    'SELECT interval_minutes FROM cadence_config WHERE id = 1'
  );
  const intervalMinutes = configResult.rows[0]?.interval_minutes || 30;

  const result = await pool.query(`
    SELECT lq.*
    FROM leads_queue lq
    WHERE lq.sdr_id = ANY($1::varchar[])
      AND lq.status IN ('PENDING', 'CALLING')
      AND lq.status NOT IN ('WON', 'LOST', 'ARCHIVED', 'ANSWERED', 'SCHEDULED', 'WRONG_NUMBER')
      AND (
        lq.last_attempt_at IS NULL
        OR lq.last_attempt_at <= NOW() - ($2 || ' minutes')::INTERVAL
      )
      AND lq.total_attempts < lq.max_attempts
    ORDER BY
       lq.created_at DESC,
       lq.last_attempt_at ASC NULLS FIRST
    LIMIT 10
  `, [onlineSdrs, intervalMinutes]);

  console.log(`[DIALER] ${result.rows.length} lead(s) para SDRs online — intervalo: ${intervalMinutes}min`);
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

async function isSdrOnline(sdrId) {
  try {
    const redis = await getRedisClient();
    const status = await redis.get(`sdr:${sdrId}:status`);
    return status === 'ONLINE';
  } catch (err) {
    console.error(`[SDR CHECK] Erro ao verificar SDR ${sdrId}:`, err.message);
    return false;
  }
}

async function processLead(lead) {
  const sdrOnline = await isSdrOnline(lead.sdr_id);
  if (!sdrOnline) return;

  const redis = await getRedisClient();
  const sdrStatus = await redis.get(`sdr:${lead.sdr_id}:status`);
  if (sdrStatus === 'BUSY') {
    console.log(`[DIALER] SDR ${lead.sdr_name} ocupado — aguardando`);
    return;
  }

  console.log(`[DIALER] Discando para ${lead.lead_name} (${lead.lead_phone}) → SDR: ${lead.sdr_name}`);

  try {
    const { initiateCall } = require('../services/twilioService');
    const callSid = await initiateCall(
      lead.id,
      lead.lead_phone,
      lead.sdr_id,
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
        (lead_queue_id, lead_id, sdr_id, phone_dialed, twilio_call_sid, status)
      VALUES ($1, $2, $3, $4, $5, 'initiated')
    `, [lead.id, lead.lead_id, lead.sdr_id, lead.lead_phone, callSid]);

    console.log(`[DIALER] Ligação iniciada — SID: ${callSid}`);

  } catch (err) {
    await pool.query(`
      UPDATE leads_queue SET status = 'PENDING', updated_at = NOW()
      WHERE id = $1
    `, [lead.id]);
    console.error(`[DIALER] Erro ao discar para ${lead.lead_name}:`, err.message);
  }
}

async function startDialerJob() {
  console.log('Scheduler iniciado — verificando leads a cada 1 minuto');

  // Libera leads travados em ANSWERED ou CALLING há mais de 1 hora
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

  // Job principal — roda a cada 1 minuto
  cron.schedule('* * * * *', async () => {
    try {
      const onlineSdrs = await getOnlineSdrs();
      if (onlineSdrs.length === 0) return;

      console.log(`[DIALER] ${onlineSdrs.length} SDR(s) online: ${onlineSdrs.join(', ')}`);

      const leads = await getLeadsDueNow(onlineSdrs);
      if (leads.length === 0) return;

      const leadsBySdr = {};
      for (const lead of leads) {
        if (!leadsBySdr[lead.sdr_id]) {
          leadsBySdr[lead.sdr_id] = lead;
        }
      }

      console.log(`[DIALER] Processando 1 lead por SDR — ${Object.keys(leadsBySdr).length} SDR(s) com leads`);

      for (const lead of Object.values(leadsBySdr)) {
        await processLead(lead);
      }
    } catch (err) {
      console.error('[DIALER] Erro no scheduler:', err.message);
    }
  });
}

module.exports = { startDialerJob };