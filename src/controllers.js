const { inserirPedidoNoPDVSeven, sincronisarStatus } = require("./models");
const { getPool } = require("./config/db");

const { keetaApi } = require("./config/axios");
const { procurarTagChaveValor } = require("./services/tag");

const pedidosController = async (req, res) => {
  await processarPedidosImportacao();
  await processarPedidosExportacao();

  res.status(200).json({ message: "Pedidos sendo processados..." });
};

const processarPedidosImportacao = async () => {
  try {
    const response = await keetaApi.get("/events:polling");
    const pedidos = response.data;

    if (pedidos.length === 0) {
      console.log("Nenhum pedido encontrado");
      return;
    }

    for (const pedido of pedidos) {
      const tag = await procurarTagChaveValor({
        chave: "keeta-orderId",
        valor: pedido.orderId,
      });

      if (!tag && pedido.eventType !== "CANCELLED") {
        console.log("adicionando pedido", pedido);
        const response = await keetaApi.get(`/orders/${pedido.orderId}`);
        inserirPedidoNoPDVSeven(response.data);
      }
    }
  } catch (error) {
    console.error("Erro ao importar pedidos:", error);
  }
};

const processarPedidosExportacao = async () => {
  const pool = await getPool();

  try {
    // Tipo: delivery, Origem: keeta, Data: 6 Horas mais recentes
    const pedidos = await pool.request().query(`
      SELECT *
      FROM [dbo].[tbPedido]
      WHERE IDTipoPedido = 30
        AND IDOrigemPedido = 5
        AND DtPedido >= DATEADD(HOUR, -6, GETDATE());
    `);

    if (pedidos.recordset.length === 0) {
      console.log("não foram encontrados pedidos...");
      return;
    }

    for (const pedido of pedidos.recordset) {
      sincronisarStatus({ pedido });
      // await new Promise((res, rej) => setTimeout(res, 5000));
    }
  } catch (error) {
    console.error("Erro ao sincronisar pedidos:", error);
  }
};

module.exports = { pedidosController };
