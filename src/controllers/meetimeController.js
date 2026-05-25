const axios = require('axios');
const pool = require('../config/database');

const MEETIME_API_URL = 'https://api.meetime.com.br/v2';
const MEETIME_TOKEN = process.env.MEETIME_API_KEY;

async function sendAnnotationsToMeetime(leadId, notes) {
  try {
    // Busca os dados atuais do lead na Meetime para não sobrescrever outros campos
    const leadResponse = await axios.get(`${MEETIME_API_URL}/leads/${leadId}`, {
      headers: { Authorization: MEETIME_TOKEN }
    });

    const lead = leadResponse.data;
    const currentAnnotations = lead.annotations || '';
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
    const newAnnotations = currentAnnotations
      ? `${currentAnnotations}\n\n[Discador - ${timestamp}]\n${notes}`
      : `[Discador - ${timestamp}]\n${notes}`;

    // Atualiza as anotações mantendo os outros campos
    await axios.put(`${MEETIME_API_URL}/leads/${leadId}`, {
      name: lead.name,
      firstName: lead.firstName,
      email: lead.email,
      company: lead.company,
      phones: lead.phones,
      annotations: newAnnotations,
      customFields: lead.customFields || {}
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