const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');
const {
  generateOutboundTwiML,
  generateTransferTwiML,
  generateNoSdrTwiML,
  generateVoicemailTwiML,
} = require('../services/twilioService');

// Retorna TwiML inicial quando o lead atende
async function outboundTwiML(req, res) {
  const { leadQueueId, sdrId } = req.query;

  res.set('Content-Type', 'text/xml');
  res.send(generateOutboundTwiML());
}

// Recebe resultado do AMD (humano ou caixa postal)
async function amdCallback(req, res) {
  const { leadQueueId, sdrId } = req.query;
  const { AnsweredBy, CallSid } = req.body;

  console.log(`[AMD] Lead ${leadQueueId} → AnsweredBy: ${AnsweredBy}`);

  try {
    const redis = await getRedisClient();

    if (AnsweredBy === 'human') {
      const sdrStatus = await redis.get(`sdr:${sdrId}:status`);

      if (sdrStatus === 'ONLINE') {
        // Transfere para o SDR via WebRTC
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

      } else {
        // SDR offline — encerra com mensagem
        const { client } = require('../services/twilioService');
        await client.calls(CallSid).update({
          twiml: generateNoSdrTwiML()
        });
      }

    } else {
      // Caixa postal — desliga silenciosamente
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