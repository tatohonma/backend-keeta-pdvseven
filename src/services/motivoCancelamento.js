const { getPool } = require("../config/db");
const sql = require("mssql");

exports.obterMotivoCancelamento = async ({ IDPedido }) => {
    const pool = await getPool();
  
    const result = await pool
      .request()
      .input("IDPedido", sql.Int, IDPedido)
      .query(`
        SELECT TOP 1 
          Nome
        FROM tbPedidoProduto pp
        INNER JOIN tbMotivoCancelamento mc ON mc.IDMotivoCancelamento = pp.IDMotivoCancelamento
        WHERE pp.IDPedido = @IDPedido;
      `);

  
    return result.recordset[0]; // Retorna o primeiro resultado (se houver)
  };