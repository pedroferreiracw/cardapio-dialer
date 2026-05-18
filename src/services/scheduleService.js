 const pool = require('../config/database');

// Converte "HH:MM" em minutos totais desde meia-noite
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Adiciona minutos a um Date e retorna novo Date
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// Gera os horários de tentativa para um dia
async function generateDailySchedule(leadQueueId, date) {
  const configResult = await pool.query('SELECT * FROM cadence_config WHERE id = 1');
  const config = configResult.rows[0];

  const businessStartMin = timeToMinutes(config.business_start.slice(0, 5));
  const businessEndMin   = timeToMinutes(config.business_end.slice(0, 5));
  const lunchStartMin    = timeToMinutes(config.lunch_start.slice(0, 5));
  const lunchEndMin      = timeToMinutes(config.lunch_end.slice(0, 5));
  const attemptsPerDay   = config.max_attempts_per_day;

  // Minutos disponíveis no dia (sem almoço)
  const morningMinutes   = lunchStartMin - businessStartMin;   // 180
  const afternoonMinutes = businessEndMin - lunchEndMin;       // 348
  const totalMinutes     = morningMinutes + afternoonMinutes;  // 528

  // Intervalo entre tentativas
  const interval = totalMinutes / (attemptsPerDay - 1);

  const schedules = [];
  let accumulated = 0;
  let lunchSkipped = false;

  for (let i = 0; i < attemptsPerDay; i++) {
    let minuteOfDay = businessStartMin + accumulated;

    // Se caiu no almoço, pula para o fim do almoço
    if (minuteOfDay >= lunchStartMin && minuteOfDay < lunchEndMin) {
      minuteOfDay = lunchEndMin;
    }

    // Monta o timestamp do dia
    const scheduledAt = new Date(date);
    scheduledAt.setHours(Math.floor(minuteOfDay / 60));
    scheduledAt.setMinutes(minuteOfDay % 60);
    scheduledAt.setSeconds(0);
    scheduledAt.setMilliseconds(0);

    schedules.push({
      slot_number: i + 1,
      attempt_number: i + 1,
      scheduled_at: scheduledAt
    });

    accumulated += interval;

    // Se o próximo horário vai cruzar o almoço, adiciona 60 min ao acumulado
    const nextMinute = businessStartMin + accumulated;
    if (!lunchSkipped && nextMinute >= lunchStartMin && nextMinute < lunchEndMin) {
      accumulated += (lunchEndMin - lunchStartMin);
      lunchSkipped = true;
    }
  }

  // Salva os horários no banco
  for (const s of schedules) {
    await pool.query(`
      INSERT INTO daily_schedules 
        (lead_queue_id, scheduled_date, slot_number, attempt_number, scheduled_at, status)
      VALUES ($1, $2, $3, $4, $5, 'PENDING')
    `, [leadQueueId, date.toISOString().split('T')[0], s.slot_number, s.attempt_number, s.scheduled_at]);
  }

  return schedules;
}

// Gera schedules para todos os 7 dias da cadência
async function generateFullCadence(leadQueueId) {
  const configResult = await pool.query('SELECT max_days FROM cadence_config WHERE id = 1');
  const maxDays = configResult.rows[0].max_days;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let day = 0; day < maxDays; day++) {
    const date = new Date(today);
    date.setDate(today.getDate() + day);

    // Pula finais de semana
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    await generateDailySchedule(leadQueueId, date);
  }
}

module.exports = { generateFullCadence, generateDailySchedule };
