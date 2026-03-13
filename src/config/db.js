const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.PDV7_DB_SERVER,
  authentication: {
    type: 'default',
    options: {
      userName: process.env.PDV7_DB_USER,
      password: process.env.PDV7_DB_PASS,
    },
  },
  options: {
    encrypt: true,
    trustServerCertificate: true,
    database: process.env.PDV7_DB_NAME,
  },
  requestTimeout: 60000,
};

let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

async function verificarConexao() {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1');
    console.log('Conexão com o banco de dados bem-sucedida.');
  } catch (err) {
    throw new Error(`Erro ao conectar no SQLServer: ${err.message}`);
  }
}

module.exports = { getPool, verificarConexao };