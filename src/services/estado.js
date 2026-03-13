const { getPool } = require("../config/db");
const sql = require("mssql");

exports.buscarIdEstado = async ({ estado }) => {
  const pool = await getPool();

  if (!estado || estado.trim() === "") {
    return 25;
  }

  const result = await pool
    .request()
    .input("Sigla", sql.VarChar, estado)
    .query(`SELECT IDEstado FROM tbEstado WHERE Sigla = @Sigla`);

  if (result.recordset.length === 0 || !result.recordset[0].IDEstado) {
    return 25;
  }

  return result.recordset[0].IDEstado;
};
