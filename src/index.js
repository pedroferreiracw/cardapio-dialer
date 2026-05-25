require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const runMigrations = require('./config/migrations');
const { getRedisClient } = require('./config/redis');
const leadsRoutes = require('./routes/leads');
const sdrsRoutes = require('./routes/sdrs');
const twilioRoutes = require('./routes/twilio');
const tokenRoutes = require('./routes/token');
const authRoutes = require('./routes/auth');
const notesRoutes = require('./routes/notes');
const closersRoutes = require('./routes/closers');
const webhooksRoutes = require('./routes/webhooks');
const { startDialerJob } = require('./jobs/dialerJob');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.set('io', io);

// Rotas
app.use('/leads', leadsRoutes);
app.use('/sdrs', sdrsRoutes);
app.use('/twilio', twilioRoutes);
app.use('/token', tokenRoutes);
app.use('/auth', authRoutes);
app.use('/notes', notesRoutes);
app.use('/closers', closersRoutes);
app.use('/webhooks', webhooksRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    message: 'Cardápio Dialer funcionando',
    timestamp: new Date().toISOString()
  });
});

// Conexões WebSocket
io.on('connection', (socket) => {
  console.log(`[SOCKET] Cliente conectado: ${socket.id}`);

  socket.on('register_sdr', (sdrId) => {
    socket.join(`sdr_${sdrId}`);
    console.log(`[SOCKET] SDR ${sdrId} registrado na sala sdr_${sdrId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);
  });
});

async function start() {
  try {
    await runMigrations();
    await getRedisClient();
    startDialerJob();
    server.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('Erro ao iniciar servidor:', err);
    process.exit(1);
  }
}

start();

module.exports = { app, io };