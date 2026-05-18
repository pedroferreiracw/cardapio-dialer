require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const runMigrations = require('./config/migrations');
const { getRedisClient } = require('./config/redis');
const leadsRoutes = require('./routes/leads');
const sdrsRoutes = require('./routes/sdrs');
const { startDialerJob } = require('./jobs/dialerJob');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

// Rotas
app.use('/leads', leadsRoutes);
app.use('/sdrs', sdrsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    message: 'Cardápio Dialer funcionando',
    timestamp: new Date().toISOString()
  });
});

async function start() {
  try {
    await runMigrations();
    await getRedisClient();
    startDialerJob();
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('Erro ao iniciar servidor:', err);
    process.exit(1);
  }
}

start();

module.exports = app;