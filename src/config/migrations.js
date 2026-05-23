const pool = require('./database');

async function runMigrations() {
  try {
    console.log('Criando tabelas...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cadence_config (
        id SERIAL PRIMARY KEY,
        max_attempts_per_day INT DEFAULT 10,
        max_days INT DEFAULT 7,
        business_start TIME DEFAULT '09:00',
        business_end TIME DEFAULT '18:48',
        lunch_start TIME DEFAULT '12:00',
        lunch_end TIME DEFAULT '13:00',
        timezone VARCHAR DEFAULT 'America/Fortaleza',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sdrs (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        phone VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE sdrs ADD COLUMN IF NOT EXISTS phone VARCHAR;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads_queue (
        id SERIAL PRIMARY KEY,
        lead_id VARCHAR NOT NULL,
        lead_name VARCHAR,
        lead_phone VARCHAR NOT NULL,
        lead_email VARCHAR,
        lead_company VARCHAR,
        sdr_id VARCHAR NOT NULL,
        sdr_name VARCHAR NOT NULL,
        cadence VARCHAR,
        prospection_id VARCHAR,
        status VARCHAR DEFAULT 'PENDING',
        attempts_today INT DEFAULT 0,
        total_attempts INT DEFAULT 0,
        days_in_cadence INT DEFAULT 0,
        next_attempt_at TIMESTAMP,
        last_attempt_at TIMESTAMP,
        answered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE leads_queue ADD COLUMN IF NOT EXISTS max_attempts INT DEFAULT 70;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_attempts (
        id SERIAL PRIMARY KEY,
        lead_queue_id INT REFERENCES leads_queue(id),
        lead_id VARCHAR NOT NULL,
        sdr_id VARCHAR NOT NULL,
        phone_dialed VARCHAR NOT NULL,
        twilio_call_sid VARCHAR,
        status VARCHAR,
        duration_seconds INT DEFAULT 0,
        attempted_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_schedules (
        id SERIAL PRIMARY KEY,
        lead_queue_id INT REFERENCES leads_queue(id),
        scheduled_date DATE NOT NULL,
        slot_number INT NOT NULL,
        attempt_number INT NOT NULL,
        scheduled_at TIMESTAMP NOT NULL,
        executed_at TIMESTAMP,
        status VARCHAR DEFAULT 'PENDING'
      );
    `);

    // Insere configuração padrão se não existir
    await pool.query(`
      INSERT INTO cadence_config (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('Tabelas criadas com sucesso!');

  } catch (err) {
    console.error('Erro ao criar tabelas:', err);
    throw err;
  }
}

module.exports = runMigrations;