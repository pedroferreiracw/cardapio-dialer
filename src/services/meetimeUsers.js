const axios = require('axios');

const MEETIME_API_URL = 'https://api.meetime.com.br/v2';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { users: null, expiresAt: 0 };
let inFlight = null;

// A API pagina com limit/start e sempre devolve next/totalItems null,
// então o fim da lista é detectado quando a página vem menor que o limit.
async function fetchAllUsers() {
  const users = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await axios.get(`${MEETIME_API_URL}/users`, {
      headers: { Authorization: process.env.MEETIME_API_KEY },
      params: { limit: PAGE_LIMIT, start: page * PAGE_LIMIT }
    });
    const items = response.data.data || [];
    users.push(...items);
    if (items.length < PAGE_LIMIT) break;
  }
  return users;
}

async function getMeetimeUsers() {
  if (cache.users && Date.now() < cache.expiresAt) return cache.users;

  // Logins simultâneos com cache vazio compartilham a mesma busca
  if (!inFlight) {
    inFlight = fetchAllUsers()
      .then(users => {
        cache = { users, expiresAt: Date.now() + CACHE_TTL_MS };
        return users;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function findMeetimeUserByEmail(email) {
  const target = (email || '').trim().toLowerCase();
  const users = await getMeetimeUsers();
  const user = users.find(u => (u.email || '').trim().toLowerCase() === target);

  if (!user) return { user: null, reason: 'not_found' };
  if (!user.active) return { user, reason: 'inactive' };
  return { user, reason: 'found' };
}

module.exports = { findMeetimeUserByEmail };
