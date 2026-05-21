const twilio = require('twilio');
const pool = require('../config/database');
const { getRedisClient } = require('../config/redis');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const BACKEND_URL = process.env.BACKEND_URL;

async function initiateCall(leadQueueId, leadPhone, sdrId, leadName) {
  try {
    const call = await client.calls.create({
      to: leadPhone,
      from: TWILIO_PHONE_NUMBER,
      url: 'https://handler.twilio.com/twiml/EHbf62fdcde9fd40e62bd6b8ae0bdf10ff',
      statusCallback: `${BACKEND_URL}/twilio/status?leadQueueId=${leadQueueId}&sdrId=${sdrId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      machineDetection: 'Enable',
      asyncAmd: 'true',
      asyncAmdStatusCallback: `${BACKEND_URL}/twilio/amd?leadQueueId=${leadQueueId}&sdrId=${sdrId}`,
      machineDetectionTimeout: 10,
      asyncAmdStatusCallbackMethod: 'POST',
      timeout: 40,
    });

    console.log(`[TWILIO] Ligação iniciada → ${leadPhone} | SID: ${call.sid}`);
    return call.sid;

  } catch (err) {
    console.error(`[TWILIO] Erro ao iniciar ligação:`, err.message);
    throw err;
  }
}

function generateOutboundTwiML() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.pause({ length: 2 });
  response.say('Ola, aguarde um momento por favor.');
  response.pause({ length: 5 });
  response.say('Obrigado pela sua paciencia.');
  response.pause({ length: 5 });

  return response.toString();
}

function generateTransferTwiML(sdrIdentity) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say('Conectando com nosso consultor.');

  const dial = response.dial({
    timeout: 30,
    action: `${BACKEND_URL}/twilio/dial-complete`,
  });

  dial.client(sdrIdentity);

  return response.toString();
}

function generateNoSdrTwiML() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say('Nossos consultores estao ocupados no momento. Entraremos em contato em breve. Obrigado.');
  response.hangup();
  return response.toString();
}

function generateVoicemailTwiML() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.hangup();
  return response.toString();
}

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