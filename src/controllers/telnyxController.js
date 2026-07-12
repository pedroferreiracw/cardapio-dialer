const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');
const { transferCallToSdr, hangupCall } = require('../services/telnyxService');

async function getLeadData(leadQueueId) {
  const result = await pool.query(`
    SELECT lq.id, lq.lead_id, lq.lead_name, lq.lead_phone,
           lq.lead_email, lq.lead_company, lq.cadence,
           lq.total_attempts, lq.sdr_id, lq.sdr_name
    FROM leads_queue lq WHERE lq.id = $1
  `, [leadQueueId]);
  return result.rows[0] || null;
}

// Marca uma tentativa como abandonada (perdeu a corrida do lock no power dialer)
async function registrarAbandono(leadQueueId, callControlId) {
  try {
    await pool.query(`
      UPDATE call_attempts
      SET abandoned = TRUE
      WHERE telnyx_call_control_id = $1
    `, [callControlId]);

    // Devolve o lead pra fila — ele não falou com ninguém, só foi descartado
    await pool.query(`
      UPDATE leads_queue
      SET status = 'PENDING', updated_at = NOW()
      WHERE id = $1 AND status = 'CALLING'
    `, [leadQueueId]);

    console.log(`[PD] Abandono registrado — lead ${leadQueueId} devolvido à fila`);
  } catch (err) {
    console.error('[PD] Erro ao registrar abandono:', err.message);
  }
}

async function handleTransfer(leadQueueId, sdrId, callControlId, source, io) {
  const redis = await getRedisClient();

  console.log(`[${source}] Tentando transferir lead ${leadQueueId} → SDR ${sdrId}`);

  // Verifica se já foi transferido (proteção rápida, não-atômica)
  const alreadyAnswered = await pool.query(
    `SELECT id FROM leads_queue WHERE id = $1 AND status = 'ANSWERED'`,
    [leadQueueId]
  );
  if (alreadyAnswered.rows.length > 0) {
    console.log(`[${source}] Lead ${leadQueueId} já transferido — ignorando`);
    return;
  }

  // ── LOCK ATÔMICO — o coração do power dialer ──────────────────────
  // Tenta reservar o SDR. Só UMA chamada vence a corrida; as demais são abandonadas.
  // NX = só cria se não existir. EX = auto-libera em 300s (trava contra lock preso).
  const reservou = await redis.set(
    `sdr:${sdrId}:lock`,
    callControlId,
    { NX: true, EX: 300 }
  );

  if (!reservou) {
    // Perdeu a corrida — SDR já está em outra chamada. Descarta esta.
    console.log(`[${source}] SDR ${sdrId} já ocupado (lock) — abandonando lead ${leadQueueId}`);
    await hangupCall(callControlId);
    await registrarAbandono(leadQueueId, callControlId);
    return;
  }

  // ── Venceu a corrida — confirma que o SDR está online antes de transferir ──
  const sdrStatus = await redis.get(`sdr:${sdrId}:status`);
  if (sdrStatus !== 'ONLINE') {
    console.log(`[${source}] SDR ${sdrId} não está ONLINE (${sdrStatus}) — liberando lock e encerrando`);
    await redis.del(`sdr:${sdrId}:lock`);
    await hangupCall(callControlId);
    return;
  }

  // A partir daqui a transferência está garantida para este lead
  await redis.setEx(`sdr:${sdrId}:status`, 43200, 'BUSY');
  await redis.setEx(`sdr:${sdrId}:current_call`, 43200, JSON.stringify({
    leadQueueId,
    callControlId,
    startedAt: new Date().toISOString()
  }));

  await pool.query(`
    UPDATE leads_queue
    SET status = 'ANSWERED', answered_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [leadQueueId]);

  const leadData = await getLeadData(leadQueueId);
  if (leadData && io) {
    io.to(`sdr_${sdrId}`).emit('incoming_call', {
      lead_id: leadData.lead_id,
      lead_name: leadData.lead_name,
      lead_phone: leadData.lead_phone,
      lead_email: leadData.lead_email,
      lead_company: leadData.lead_company,
      cadence: leadData.cadence,
      attempt: leadData.total_attempts,
      call_control_id: callControlId
    });
    console.log(`[${source}] Dados enviados via WebSocket para sdr_${sdrId}`);
  }

  await transferCallToSdr(callControlId, sdrId);
  console.log(`[${source}] Lead ${leadQueueId} transferido para SDR ${sdrId}`);
}

// TeXML inicial — mantém chamada em espera enquanto AMD processa
async function twimlResponse(req, res) {
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="15"/>
</Response>`);
}

// Recebe todos os eventos Telnyx
async function statusCallback(req, res) {
  res.sendStatus(200); // Responde imediatamente

  const { leadQueueId, sdrId } = req.query;
  const io = req.app.get('io');

  const event = req.body?.data;
  if (!event) return;

  const { event_type, payload } = event;
  const callControlId = payload?.call_control_id;

  console.log(`[TELNYX] ${event_type} | Lead: ${leadQueueId} | SDR: ${sdrId}`);

  try {
    switch (event_type) {

      case 'call.initiated':
        await pool.query(`
          UPDATE call_attempts SET status = 'initiated'
          WHERE telnyx_call_control_id = $1
        `, [callControlId]);
        break;

      case 'call.ringing':
        await pool.query(`
          UPDATE call_attempts SET status = 'ringing'
          WHERE telnyx_call_control_id = $1
        `, [callControlId]);
        break;

      case 'call.answered':
        // Aguarda resultado do AMD
        console.log(`[TELNYX] Lead ${leadQueueId} atendeu — aguardando AMD`);
        break;

      case 'call.machine.premium.detection.ended': {
        const amdResult = payload.result;
        console.log(`[TELNYX] AMD premium Lead ${leadQueueId} → ${amdResult}`);

        // AMD premium retorna: human_residence, human_business, machine, silence, fax_detected, not_sure
        const isHuman = amdResult === 'human_residence'
          || amdResult === 'human_business'
          || amdResult === 'not_sure'; // na dúvida, transfere — melhor que perder lead

        if (isHuman) {
          await handleTransfer(leadQueueId, sdrId, callControlId, 'AMD', io);
        } else {
          console.log(`[TELNYX] Caixa postal/máquina detectada (${amdResult}) — encerrando`);
          await hangupCall(callControlId);
          await pool.query(`
            UPDATE call_attempts SET status = 'voicemail'
            WHERE telnyx_call_control_id = $1
          `, [callControlId]);
        }
        break;
      }

      case 'call.machine.premium.greeting.ended': {
        // Só desliga se a chamada NÃO foi transferida (lead não está ANSWERED)
        const answered = await pool.query(
          `SELECT id FROM leads_queue WHERE id = $1 AND status = 'ANSWERED'`,
          [leadQueueId]
        );
        if (answered.rows.length === 0) {
          console.log(`[TELNYX] Saudação de caixa postal encerrada — desligando Lead ${leadQueueId}`);
          await hangupCall(callControlId);
        }
        break;
      }

      case 'call.hangup': {
        const hangupCause = payload.hangup_cause;
        const durationSecs = payload.end_time && payload.start_time
          ? Math.floor((new Date(payload.end_time) - new Date(payload.start_time)) / 1000)
          : 0;

        console.log(`[TELNYX] Hangup | causa: ${hangupCause} | duração: ${durationSecs}s`);

        if (['no_answer', 'user_busy', 'call_rejected', 'originator_cancel'].includes(hangupCause)) {
          await pool.query(`
            UPDATE call_attempts SET status = $1
            WHERE telnyx_call_control_id = $2
          `, [hangupCause, callControlId]);

          await pool.query(`
            UPDATE leads_queue SET status = 'PENDING', updated_at = NOW()
            WHERE id = $1 AND status = 'CALLING'
          `, [leadQueueId]);
        }

        if (durationSecs > 0) {
          await pool.query(`
            UPDATE call_attempts
            SET status = 'completed', duration_seconds = $1
            WHERE telnyx_call_control_id = $2
          `, [durationSecs, callControlId]);
        }

        if (io) {
          io.to(`sdr_${sdrId}`).emit('call_ended', {
            leadQueueId,
            callControlId,
            duration: durationSecs
          });
        }

        const redis = await getRedisClient();
        const sdrStatus = await redis.get(`sdr:${sdrId}:status`);
        if (sdrStatus === 'BUSY') {
          await redis.setEx(`sdr:${sdrId}:status`, 43200, 'ONLINE');
          await redis.del(`sdr:${sdrId}:current_call`);
        }
        // Libera o lock do power dialer — SDR volta a poder receber transferências
        await redis.del(`sdr:${sdrId}:lock`);
        break;
      }
    }
  } catch (err) {
    console.error('[TELNYX] Erro no handler:', err.message);
  }
}

module.exports = { twimlResponse, statusCallback };