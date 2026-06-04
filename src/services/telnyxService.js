const axios = require('axios');

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_APP_ID = process.env.TELNYX_APP_ID;
const TELNYX_SIP_CONNECTION_ID = process.env.TELNYX_SIP_CONNECTION_ID;
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;
const BACKEND_URL = process.env.BACKEND_URL;

const telnyxAPI = axios.create({
  baseURL: 'https://api.telnyx.com/v2',
  headers: {
    'Authorization': `Bearer ${TELNYX_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function initiateCall(leadQueueId, leadPhone, sdrId, leadName) {
  const response = await telnyxAPI.post('/calls', {
    connection_id: TELNYX_APP_ID,
    to: leadPhone,
    from: TELNYX_PHONE_NUMBER,
    webhook_url: `${BACKEND_URL}/telnyx/status?leadQueueId=${leadQueueId}&sdrId=${sdrId}`,
    webhook_url_method: 'POST',
    answering_machine_detection: 'premium',
    answering_machine_detection_config: {
      total_analysis_time_millis: 10000,
      after_silence_millis: 800,
      between_words_silence_millis: 50,
      maximum_number_of_words: 5,
      silence_threshold: 256
    },
    timeout_secs: 40
  });

  const callControlId = response.data.data.call_control_id;
  console.log(`[TELNYX] Ligação iniciada → ${leadPhone} | ID: ${callControlId}`);
  return callControlId;
}

async function transferCallToSdr(callControlId, sdrId) {
  await telnyxAPI.post(`/calls/${callControlId}/actions/transfer`, {
    to: `sip:sdr${sdrId}@cardapio-dialer.sip.telnyx.com`,
    from: TELNYX_PHONE_NUMBER
  });
  console.log(`[TELNYX] Chamada transferida para sdr${sdrId}`);
}

async function hangupCall(callControlId) {
  try {
    await telnyxAPI.post(`/calls/${callControlId}/actions/hangup`, {});
    console.log(`[TELNYX] Chamada encerrada: ${callControlId}`);
  } catch (err) {
    console.error('[TELNYX] Erro ao desligar:', err.message);
  }
}

async function getSdrToken(sdrId) {
  try {
    const credName = `sdr${sdrId}`;

    const listResponse = await telnyxAPI.get('/telephony_credentials', {
      params: { 'filter[tag]': credName }
    });

    let credId;
    if (listResponse.data.data && listResponse.data.data.length > 0) {
      credId = listResponse.data.data[0].id;
    } else {
      const createResponse = await telnyxAPI.post('/telephony_credentials', {
        connection_id: TELNYX_SIP_CONNECTION_ID,
        name: credName,
        tag: credName
      });
      credId = createResponse.data.data.id;
    }

    const tokenResponse = await telnyxAPI.post(
      `/telephony_credentials/${credId}/token`, {}
    );

    console.log(`[TELNYX] Token gerado para SDR ${sdrId}`);
    return tokenResponse.data.token;

  } catch (err) {
    console.error('[TELNYX] Erro ao gerar token:', JSON.stringify(err.response?.data || err.message));
    throw err;
  }
}

module.exports = { initiateCall, transferCallToSdr, hangupCall, getSdrToken };