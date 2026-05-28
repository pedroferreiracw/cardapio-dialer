const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');
const {
  generateTransferTwiML,
  generateNoSdrTwiML,
  generateVoicemailTwiML,
} = require('../services/twilioService');
const { sendPushToSdr } = require('../routes/push');

// Busca dados completos do lead para enviar ao painel
async function getLeadData(leadQueueId) {
  const result = await pool.query(`
    SELECT 
      lq.id,
      lq.lead_id,
      lq.lead_name,
      lq.lead_phone,
      lq.lead_email,
      lq.lead_company,
      lq.cadence,
      lq.total_attempts,
      lq.sdr_id,
      lq.sdr_name
    FROM leads_queue lq
    WHERE lq.id = $1
  `, [leadQueueId]);

  return result.rows[0] || null;
}

// Lógica central de transferência
async function transferCall(leadQueueId, sdrId, CallSid, source, io) {
  const redis = await getRedisClient();
  const sdrStatus = await redis.get(`sdr:${sdrId}:status`);
  console.log(`[${source}] Transferindo lead ${leadQueueId} → SDR ${sdrId} (status=${sdrStatus})`);

  // Verifica se já foi transferido
  const alreadyAnswered = await pool.query(
    `SELECT id FROM leads_queue WHERE id = $1 AND status = 'ANSWERED'`,
    [leadQueueId]
  );
  if (alreadyAnswered.rows.length > 0) {
    console.log(`[${source}] Lead ${leadQueueId} já foi transferido — ignorando`);
    return;
  }

  if (sdrStatus === 'ONLINE') {
    const sdrIdentity = `sdr_${sdrId}`;

    await redis.setEx(`sdr:${sdrId}:status`, 43200, 'BUSY');
    await redis.setEx(`sdr:${sdrId}:current_call`, 43200, JSON.stringify({
      leadQueueId,
      callSid: CallSid,
      startedAt: new Date().toISOString()
    }));

    await pool.query(`
      UPDATE leads_queue
      SET status = 'ANSWERED', answered_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [leadQueueId]);

    // Envia dados do lead para o painel via WebSocket
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
        call_sid: CallSid
      });
      console.log(`[${source}] Dados do lead enviados via WebSocket para sdr_${sdrId}`);

      // Envia push notification para tela bloqueada
      sendPushToSdr(sdrId, {
        title: '📞 Lead atendeu!',
        body: `${leadData.lead_name}${leadData.lead_company ? ' — ' + leadData.lead_company : ''}`,
        url: 'https://discador.cardapioweb.com.br'
      }).catch(() => {});
    }

    const { client } = require('../services/twilioService');
    await client.calls(CallSid).update({
      twiml: generateTransferTwiML(sdrIdentity)
    });

    console.log(`[${source}] Chamada transferida para ${sdrIdentity}`);

  } else {
    console.log(`[${source}] SDR ${sdrId} offline — encerrando chamada`);
    const { client } = require('../services/twilioService');
    await client.calls(CallSid).update({
      twiml: generateNoSdrTwiML()
    });
  }
}

// TwiML inicial — sem mensagem, transfere imediatamente
async function outboundTwiML(req, res) {
  res.set('Content-Type', 'text/xml');
  const twilio = require('twilio');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.pause({ length: 1 });
  res.send(response.toString());
}

// AMD — só usado para detectar caixa postal e desligar
async function amdCallback(req, res) {
  const { leadQueueId, sdrId } = req.query;
  const { AnsweredBy, CallSid } = req.body;

  console.log(`[AMD] Lead ${leadQueueId} → AnsweredBy: ${AnsweredBy}`);

  try {
    if (AnsweredBy !== 'human') {
      console.log(`[AMD] Caixa postal detectada — encerrando`);
      const { client } = require('../services/twilioService');
      await client.calls(CallSid).update({
        twiml: generateVoicemailTwiML()
      });

      await pool.query(`
        UPDATE call_attempts
        SET status = 'voicemail'
        WHERE twilio_call_sid = $1
      `, [CallSid]);
    }
  } catch (err) {
    console.error('[AMD] Erro:', err.message);
  }

  res.sendStatus(200);
}

// Status callback — transfere IMEDIATAMENTE quando lead atende
async function statusCallback(req, res) {
  const { leadQueueId, sdrId } = req.query;
  const { CallStatus, CallSid, CallDuration } = req.body;
  const io = req.app.get('io');

  console.log(`[STATUS] Lead ${leadQueueId} → ${CallStatus}`);

  try {
    if (CallStatus === 'in-progress') {
      await transferCall(leadQueueId, sdrId, CallSid, 'STATUS', io);
    }

    if (CallStatus === 'no-answer' || CallStatus === 'busy' || CallStatus === 'failed') {
      await pool.query(`
        UPDATE call_attempts
        SET status = $1
        WHERE twilio_call_sid = $2
      `, [CallStatus, CallSid]);

      await pool.query(`
        UPDATE leads_queue
        SET status = 'PENDING', updated_at = NOW()
        WHERE id = $1 AND status = 'CALLING'
      `, [leadQueueId]);
    }

    if (CallStatus === 'completed' && CallDuration) {
      await pool.query(`
        UPDATE call_attempts
        SET status = 'completed', duration_seconds = $1
        WHERE twilio_call_sid = $2
      `, [parseInt(CallDuration), CallSid]);

      if (io) {
        io.to(`sdr_${sdrId}`).emit('call_ended', {
          leadQueueId,
          callSid: CallSid,
          duration: parseInt(CallDuration)
        });
      }

      const redis = await getRedisClient();
      const sdrStatus = await redis.get(`sdr:${sdrId}:status`);
      if (sdrStatus === 'BUSY') {
        await redis.setEx(`sdr:${sdrId}:status`, 43200, 'ONLINE');
        await redis.del(`sdr:${sdrId}:current_call`);
      }
    }

  } catch (err) {
    console.error('[STATUS] Erro:', err.message);
  }

  res.sendStatus(200);
}

// Chamado quando o dial para o SDR completa
async function dialComplete(req, res) {
  res.set('Content-Type', 'text/xml');
  const twilio = require('twilio');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.hangup();
  res.send(response.toString());
}

module.exports = { outboundTwiML, amdCallback, statusCallback, dialComplete };