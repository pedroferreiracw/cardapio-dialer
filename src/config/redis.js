const redis = require('redis');

let client;
let isConnected = false;

async function getRedisClient() {
  if (client && isConnected) return client;

  client = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          console.log('Redis: máximo de tentativas atingido, aguardando 30s...');
          return 30000;
        }
        return Math.min(retries * 1000, 10000);
      },
      connectTimeout: 10000,
    }
  });

  client.on('connect', () => {
    console.log('Redis conectado');
    isConnected = true;
  });

  client.on('error', (err) => {
    isConnected = false;
    // Só loga erros diferentes para não poluir o terminal
    if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
      console.log(`Redis: reconectando... (${err.code})`);
    } else {
      console.error('Erro no Redis:', err.message);
    }
  });

  client.on('reconnecting', () => {
    console.log('Redis: tentando reconectar...');
  });

  await client.connect();
  return client;
}

module.exports = { getRedisClient };