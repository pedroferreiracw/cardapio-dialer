const twilio = require('twilio');
const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const BACKEND_URL = process.env.BACKEND_URL;

// Inicia uma ligação para o lead
async function initiateCall(leadQueueId, leadPhone, sdrId, leadName) {
  try {
    const call = await client.calls.create({
      to: leadPhone,
      from: TWILIO_PHONE_NUMBER,
      url: `${BACKEND_URL}/twilio/twiml/outbound?leadQueueId=${leadQueueId}&sdrId=${sdrId}`,
      statusCallback: `${BACKEND_URL}/twilio/status?leadQueueId=${leadQueueId}&sdrId=${sdrId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      machineDetection: 'DetectMessageEnd',
      asyncAmd: 'true',
      asyncAmdStatusCallback: `${BACKEND_URL}/twilio/amd?leadQueueId=${leadQueueId}&sdrId=${sdrId}`,
      timeout: 30,
    });

    console.log(`[TWILIO] Ligação iniciada → ${leadPhone} | SID: ${call.sid}`);
    return call.sid;

  } catch (err) {
    console.error(`[TWILIO] Erro ao iniciar ligação:`, err.message);
    throw err;
  }
}

// Gera TwiML para quando o lead atender (antes do AMD confirmar)
function generateOutboundTwiML() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.pause({ length: 1 });
  response.say({
    language: 'pt-BR',
    voice: 'Polly.Camila'
  }, 'Por favor, aguarde um momento.');
  response.pause({ length: 2 });

  return response.toString();
}

// Gera TwiML para transferir a chamada para o SDR via WebRTC
function generateTransferTwiML(sdrIdentity) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say({
    language: 'pt-BR',
    voice: 'Polly.Camila'
  }, 'Conectando com nosso consultor.');

  const dial = response.dial({
    timeout: 30,
    action: `${BACKEND_URL}/twilio/dial-complete`,
  });

  dial.client(sdrIdentity);

  return response.toString();
}

// Gera TwiML para quando SDR não atender a transferência
function generateNoSdrTwiML() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say({
    language: 'pt-BR',
    voice: 'Polly.Camila'
  }, 'Nossos consultores estão ocupados no momento. Entraremos em contato em breve. Obrigado.');

  response.hangup();
  return response.toString();
}

// Gera TwiML para caixa postal detectada
function generateVoicemailTwiML() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.hangup();
  return response.toString();
}

// Busca o número do SDR no banco
async function getSdrPhone(sdrId) {
  const result = await pool.query(
    'SELECT phone FROM sdrs WHERE id = $1',
    [sdrId]
  );
  return result.rows[0]?.phone || null;
}

module.exports = {
  initiateCall,
  generateOutboundTwiML,
  generateTransferTwiML,
  generateNoSdrTwiML,
  generateVoicemailTwiML,
  getSdrPhone,
  client
};