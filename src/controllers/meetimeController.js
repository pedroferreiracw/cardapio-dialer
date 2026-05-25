const axios = require('axios');

const MEETIME_API_URL = 'https://api.meetime.com.br/v2';
const MEETIME_TOKEN = process.env.MEETIME_API_KEY;

async function sendAnnotationsToMeetime(leadId, notes) {
  try {
    const timestamp = new Date().toLocaleString('pt-BR', { 
      timeZone: 'America/Fortaleza' 
    });

    const annotations = `[Discador - ${timestamp}]\n${notes}`;

    await axios.put(`${MEETIME_API_URL}/leads/${leadId}`, {
      annotations
    }, {
      headers: { Authorization: MEETIME_TOKEN }
    });

    console.log(`[MEETIME] Anotações enviadas para lead ${leadId}`);
    return true;

  } catch (err) {
    console.error(`[MEETIME] Erro ao enviar anotações:`, err.message);
    return false;
  }
}

module.exports = { sendAnnotationsToMeetime };