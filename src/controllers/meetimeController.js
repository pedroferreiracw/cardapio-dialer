const axios = require('axios');

const MEETIME_API_URL = 'https://api.meetime.com.br/v2';
const MEETIME_TOKEN = process.env.MEETIME_API_KEY;

async function sendAnnotationsToMeetime(leadId, notes) {
  // Não envia se as anotações estiverem vazias
  if (!notes || !notes.trim()) {
    console.log(`[MEETIME] Anotações vazias — ignorando lead ${leadId}`);
    return false;
  }

  // Não envia se o leadId for inválido
  if (!leadId || leadId === 'undefined' || leadId === 'null') {
    console.log(`[MEETIME] Lead ID inválido — ignorando`);
    return false;
  }

  try {
    const timestamp = new Date().toLocaleString('pt-BR', { 
      timeZone: 'America/Fortaleza' 
    });

    const annotations = `[Discador - ${timestamp}]\n${notes.trim()}`;

    await axios.put(`${MEETIME_API_URL}/leads/${leadId}`, {
      annotations
    }, {
      headers: { Authorization: MEETIME_TOKEN }
    });

    console.log(`[MEETIME] Anotações enviadas para lead ${leadId}`);
    return true;

  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error || err.message;
    console.error(`[MEETIME] Erro ${status} ao enviar anotações para lead ${leadId}: ${message}`);
    return false;
  }
}

module.exports = { sendAnnotationsToMeetime };