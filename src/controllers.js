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

    for (const pedidokeeta of pedidos) {
      const tag = await procurarTagChaveValor({
        chave: "keeta-orderId",
        valor: pedidokeeta.orderId,
      });

      if (!tag && pedidokeeta.eventType !== "CANCELLED") {
        console.log("adicionando pedido", pedidokeeta);
        const response = await keetaApi.get(`/orders/${pedidokeeta.orderId}`);

        const pedido = response.data;

        const encryptedFields = {
          customerNumber: pedido.customer.phone.number,
          deliveryDistrict: pedido.delivery.deliveryAddress.district,
          deliveryNumber: pedido.delivery.deliveryAddress.number,
          complement: pedido.delivery.deliveryAddress.complement,
          formattedAddress: pedido.delivery.deliveryAddress.formattedAddress,
        };

        const encrypetedInfos = Object.values(encryptedFields)
          .filter((value) => {
            return typeof value === "string" && value.startsWith("ENC_");
          })
          .map((value) => ({ cipherText: value }));

        if (encrypetedInfos.length > 0) {
          const res = await keetaApi.post("/batchDecrypt", {
            cipherInfos: encrypetedInfos,
          });

          const decrypted = {};
          Object.entries(encryptedFields).forEach(([key, value], i) => {
            const v = res.data.plainInfos.find((e) => e?.cipherText === value);
            decrypted[key] = v?.plainText ?? value;
          });

          pedido.customer.phone.number = decrypted.customerNumber;
          pedido.delivery.deliveryAddress.district = decrypted.deliveryDistrict;
          pedido.delivery.deliveryAddress.number = decrypted.deliveryNumber;
          pedido.delivery.deliveryAddress.complement = decrypted.complement;
          pedido.delivery.deliveryAddress.formattedAddress =
            decrypted.formattedAddress;
        }

        inserirPedidoNoPDVSeven(pedido);
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
