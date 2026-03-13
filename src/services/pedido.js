const { getPool } = require("../config/db")
const sql = require("mssql");

exports.atualizarStatusPedido = async ({ GUID, IDStatusPedido }) => {
    const pool = await getPool();
  
    const result = await pool
      .request()
      .input("GUIDIdentificacao", sql.NVarChar(50), GUID)
      .input("IDStatusPedido", sql.Int, IDStatusPedido)
      .query(`
        UPDATE [dbo].[tbPedido]
        SET IDStatusPedido = @IDStatusPedido
        WHERE GUIDIdentificacao = @GUIDIdentificacao;
      `);
  
    return result.rowsAffected; 
};