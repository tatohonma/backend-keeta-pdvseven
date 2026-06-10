const { getPool } = require("../config/db");
const sql = require("mssql");

exports.procurarCaixaAberto = async ({ idPDV }) => {
  const pool = await getPool();

  const caixa = await pool.request().input("IDPDV", sql.Int, idPDV).query(`
      SELECT TOP 1 IDCaixa
      FROM tbCaixa
      WHERE IDPDV = @IDPDV
        AND IDFechamento IS NULL
      ORDER BY IDCaixa DESC;
    `);

  return caixa.recordset[0];
};
