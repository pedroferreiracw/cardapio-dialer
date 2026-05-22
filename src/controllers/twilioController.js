const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');
const {
  generateTransferTwiML,
  generateNoSdrTwiML,
  generateVoicemailTwiML,
} = require('../services/twilioService');

// Lógica central de transferência — usada pelo AMD e pelo statusCallback
async function transferCall(leadQueueId, sdrId, CallSid, source) {
  const redis = await getRedisClient();
  const sdrStatus = await redis.get(`sdr:${sdrId}:status`);
  console.log(`[${source}] Transferindo lead ${leadQueueId} → SDR ${sdrId} (status=${sdrStatus})`);

  // Verifica se já foi transferido (evita dupla transferência)
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

// Retorna TwiML inicial quando o lead atende
async function outboundTwiML(req, res) {
  console.log(`[TWIML] Endpoint chamado — leadQueueId=${req.query.leadQueueId}`);
  res.set('Content-Type', 'text/xml');
  const twilio = require('twilio');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.pause({ length: 2 });
  response.say('Ola, aguarde um momento por favor.');
  response.pause({ length: 5 });
  response.say('Obrigado pela sua paciencia.');
  response.pause({ length: 5 });
  res.send(response.toString());
}

// Recebe resultado do AMD
async function amdCallback(req, res) {
  const { leadQueueId, sdrId } = req.query;
  const { AnsweredBy, CallSid } = req.body;

  console.log(`[AMD] Lead ${leadQueueId} → AnsweredBy: ${AnsweredBy}`);

  try {
    if (AnsweredBy === 'human') {
      await transferCall(leadQueueId, sdrId, CallSid, 'AMD');

    } else {
      // Caixa postal — desliga silenciosamente
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

// Recebe atualizações de status da chamada
async function statusCallback(req, res) {
  const { leadQueueId, sdrId } = req.query;
  const { CallStatus, CallSid, CallDuration } = req.body;

  console.log(`[STATUS] Lead ${leadQueueId} → ${CallStatus}`);

  try {
    // Fallback: se in-progress e AMD ainda não transferiu, transfere aqui
    if (CallStatus === 'in-progress') {
      setTimeout(async () => {
        try {
          await transferCall(leadQueueId, sdrId, CallSid, 'STATUS-FALLBACK');
        } catch (err) {
          console.log(`[STATUS-FALLBACK] Ignorado: ${err.message}`);
        }
      }, 8000); // Aguarda 8s para o AMD ter chance de agir primeiro
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