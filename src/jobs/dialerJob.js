const cron = require('node-cron');
const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

async function isBusinessHours() {
  const configResult = await pool.query('SELECT * FROM cadence_config WHERE id = 1');
  const config = configResult.rows[0];

  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const utcOffset = now.getTimezoneOffset();
  const brasiliaTime = new Date(now.getTime() + (utcOffset + brasiliaOffset) * 60000);

  const currentMinutes = brasiliaTime.getHours() * 60 + brasiliaTime.getMinutes();
  const dayOfWeek = brasiliaTime.getDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const [startH, startM] = config.business_start.slice(0, 5).split(':').map(Number);
  const [endH, endM] = config.business_end.slice(0, 5).split(':').map(Number);
  const [lunchStartH, lunchStartM] = config.lunch_start.slice(0, 5).split(':').map(Number);
  const [lunchEndH, lunchEndM] = config.lunch_end.slice(0, 5).split(':').map(Number);

  const businessStart = startH * 60 + startM;
  const businessEnd = endH * 60 + endM;
  const lunchStart = lunchStartH * 60 + lunchStartM;
  const lunchEnd = lunchEndH * 60 + lunchEndM;

  if (currentMinutes < businessStart || currentMinutes >= businessEnd) return false;
  if (currentMinutes >= lunchStart && currentMinutes < lunchEnd) return false;

  return true;
}

async function getLeadsDueNow() {
  const result = await pool.query(`
    SELECT
      lq.*,
      ds.id as schedule_id,
      ds.scheduled_at
    FROM daily_schedules ds
    JOIN leads_queue lq ON lq.id = ds.lead_queue_id
    WHERE ds.status = 'PENDING'
      AND ds.scheduled_at <= NOW()
      AND lq.status IN ('PENDING', 'CALLING')
      AND lq.status NOT IN ('WON', 'LOST', 'ARCHIVED')
    ORDER BY ds.scheduled_at ASC
    LIMIT 50
  `);

  console.log(`[DIALER] Query retornou ${result.rows.length} leads. IDs dos SDRs: ${[...new Set(result.rows.map(r => r.sdr_id))].join(', ')}`);
  return result.rows;
}

async function isSdrOnline(sdrId) {
  try {
    const redis = await getRedisClient();
    const status = await redis.get(`sdr:${sdrId}:status`);
    console.log(`[SDR CHECK] sdr_id=${sdrId} status_no_redis=${status}`);

    // Se Redis não tem o status, verifica variável de ambiente de teste
    if (!status && process.env.FORCE_SDR_ONLINE === sdrId) {
      console.log(`[SDR CHECK] sdr_id=${sdrId} forçado ONLINE via FORCE_SDR_ONLINE`);
      return true;
    }

    return status === 'ONLINE';
  } catch (err) {
    console.error(`[SDR CHECK] Erro ao verificar SDR ${sdrId}:`, err.message);
    return false;
  }
}

async function processLead(lead) {
  const sdrOnline = await isSdrOnline(lead.sdr_id);

  if (!sdrOnline) {
    console.log(`SDR ${lead.sdr_name} offline — ${lead.lead_name} aguardando`);
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
      UPDATE daily_schedules
      SET status = 'EXECUTED', executed_at = NOW()
      WHERE id = $1
    `, [lead.schedule_id]);

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
    console.error(`[DIALER] Erro ao discar para ${lead.lead_name}:`, err.message);
    console.error(`[DIALER] Stack:`, err.stack);
  }
}

async function startDialerJob() {
  console.log('Scheduler iniciado — verificando leads a cada 1 minuto');

  cron.schedule('* * * * *', async () => {
    try {
      const businessHours = await isBusinessHours();
      const forceTest = process.env.FORCE_TEST === 'true';
      console.log(`[DIALER] businessHours=${businessHours} forceTest=${forceTest}`);
      if (!businessHours && !forceTest) return;

      const leads = await getLeadsDueNow();
      if (leads.length === 0) return;

      console.log(`[DIALER] ${leads.length} lead(s) para discar agora`);

      for (const lead of leads) {
        await processLead(lead);
      }
    } catch (err) {
      console.error('[DIALER] Erro no scheduler:', err.message);
    }
  });
}

module.exports = { startDialerJob };