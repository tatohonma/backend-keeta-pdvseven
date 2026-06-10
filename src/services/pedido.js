const { getPool } = require("../config/db");
const sql = require("mssql");

exports.atualizarStatusPedido = async ({
  GUID,
  IDStatusPedido,
  dtPedidoFechamento = null,
  idCaixa = null,
}) => {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("GUIDIdentificacao", sql.NVarChar(50), GUID)
    .input("IDStatusPedido", sql.Int, IDStatusPedido)
    .input("DtPedidoFechamento", sql.DateTime, dtPedidoFechamento)
    .input("IDCaixa", sql.Int, idCaixa).query(`
        UPDATE [dbo].[tbPedido]
        SET IDStatusPedido = @IDStatusPedido,
        DtPedidoFechamento = @DtPedidoFechamento,
        IDCaixa = @IDCaixa
        WHERE GUIDIdentificacao = @GUIDIdentificacao;
      `);

  return result.rowsAffected;
};
