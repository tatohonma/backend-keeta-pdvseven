const { getPool } = require("../config/db");
const sql = require("mssql");

exports.atualizarStatusPedido = async ({
  GUID,
  IDStatusPedido,
  dtPedidoFechamento = null,
}) => {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("GUIDIdentificacao", sql.NVarChar(50), GUID)
    .input("IDStatusPedido", sql.Int, IDStatusPedido)
    .input("DtPedidoFechamento", sql.DateTime, dtPedidoFechamento).query(`
        UPDATE [dbo].[tbPedido]
        SET IDStatusPedido = @IDStatusPedido,
        DtPedidoFechamento = @DtPedidoFechamento
        WHERE GUIDIdentificacao = @GUIDIdentificacao;
      `);

  return result.rowsAffected;
};
