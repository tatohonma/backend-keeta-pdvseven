const sql = require("mssql");
const { v4: uuidv4 } = require("uuid");
const { getPool } = require("./config/db");
const { getConfiguracoes } = require("./config/pdv7");
const { keetaApi } = require("./config/axios");
const { obterMotivoCancelamento } = require("./services/motivoCancelamento");

const {
  procurarTagGUIDChave,
  procurarTagChaveValor,
  atualizarValorTag,
  criarTag,
} = require("./services/tag");

const { atualizarStatusPedido } = require("./services/pedido");
const {
  criarNovoCliente,
  atualizarCliente,
  buscarClientePorGUID,
} = require("./services/cliente");
const { buscarIdEstado } = require("./services/estado");
const { toCurrency } = require("./utils/currency");

let config = {};

const inserirPedidoNoPDVSeven = async (pedido) => {
  console.log(`Adicionar pedido ${pedido.id}\n`);

  try {
    config = getConfiguracoes();

    const idCliente = await adicionarCliente({ pedido });
    const insertedId = await adicionarPedido(pedido, idCliente);

    await adicionarProdutos(pedido, insertedId);
    const pagamentos = await adicionarPagamentos(pedido, insertedId);

    const ticket = formatarTicket(pedido, pedido.customer, pagamentos);

    const pool = await getPool();
    await pool
      .request()
      .input("IDPedido", sql.Int, insertedId)
      .input("Observacoes", sql.NVarChar(sql.MAX), ticket)
      .query(
        `UPDATE tbPedido SET Observacoes = @Observacoes WHERE IDPedido = @IDPedido`,
      );

    console.log("");
    console.log("------------------------------------------");
    console.log(ticket);
    console.log("------------------------------------------");
  } catch (error) {
    console.error("Erro ao inserir pedido:", error);
  }
};

const adicionarCliente = async ({ pedido }) => {
  const clienteExistenteTag = await procurarTagChaveValor({
    chave: "keeta-customerId",
    valor: pedido.customer.id,
  });

  const ext = pedido.customer.phone.extension;
  const ddd = ext && !isNaN(ext) ? Number(ext) : 0;

  const num = pedido.customer.phone.number;
  const telefone = !isNaN(num) && String(num).length <= 9 ? num : 0;

  let bairro,
    cep,
    cidade,
    complemento,
    enderecoDeReferenia,
    rua,
    numero,
    idEstado,
    nomeCompleto,
    documento;

  document = pedido.customer.id;
  nomeCompleto = pedido.customer.name;

  if (pedido.type === "TAKEOUT") {
    console.log("📌 Pedido TAKEOUT detectado — usando endereço padrão.");

    bairro = "RETIRADA";
    cep = "0";
    cidade = "RETIRADA";
    complemento = "";
    enderecoDeReferenia = "";
    rua = "RETIRADA NO LOCAL";
    numero = "S/N";
    idEstado = 25; // Fixado conforme solicitado
  } else {
    const endereco = pedido.delivery.deliveryAddress;

    enderecoDeReferenia = endereco.formattedAddress;
    bairro = endereco.district;
    cep = endereco.postalCode ? endereco.postalCode.replace(/\D/g, "") : "0";
    cidade = endereco.city;
    complemento = endereco.complement;
    rua = endereco.street;
    numero = endereco.number;

    idEstado = await buscarIdEstado({ estado: endereco.state });
  }

  if (!clienteExistenteTag) {
    const guid = uuidv4();

    const cliente = await criarNovoCliente({
      bairro,
      cep,
      cidade,
      complemento,
      ddd,
      telefone,
      idEstado,
      nomeCompleto,
      enderecoDeReferenia,
      rua,
      numero,
      guid,
      documento,
    });

    await criarTag({
      GUID: guid,
      chave: "keeta-customerId",
      valor: pedido.customer.id,
    });

    console.log("✅ Novo cliente adicionado");
    return cliente.IDCliente;
  }

  const clienteExistente = await buscarClientePorGUID({
    guid: clienteExistenteTag.GUIDIdentificacao,
  });

  await atualizarCliente({
    bairro,
    cep,
    cidade,
    complemento,
    enderecoDeReferenia,
    rua,
    numero,
    idCliente: clienteExistente.IDCliente,
    idEstado,
    nomeCompleto,
    ddd,
    telefone,
    documento,
  });

  console.log("✅ Dados do cliente atualizado");
  return clienteExistente.IDCliente;
};

const calcularValorTotalDoPedido = (pedido) => {
  const valorDaEntrega =
    pedido.otherFees.find((f) => f.name === "DELIVERY_FEE")?.price?.value ?? 0;

  return pedido.total.itemsPrice.value + valorDaEntrega;
};

const adicionarPedido = async (pedido, idCliente) => {
  const pool = await getPool();

  const idTipoDesconto = config.tipoDesconto.IDTipoDesconto;
  const idTaxaEntrega = config.taxaEntrega.IDTaxaEntrega;
  const idOrigemPedido = config.origemPedido.IDOrigemPedido;
  const idEntregador = config.entregador.IDEntregador;

  const descontos = pedido.otherFees.filter(
    (f) => !["DELIVERY_FEE", "TIP"].includes(f.name),
  );

  const valorTotal = calcularValorTotalDoPedido(pedido);

  const valorDaEntrega =
    pedido.otherFees.find((f) => f.name === "DELIVERY_FEE")?.price?.value ?? 0;

  // const valorTotalDosDescontos = descontos.reduce((acc, curr) => {
  //   return acc + curr.price.value;
  // }, 0);

  const observacoes = "";
  // const aplicarDesconto = valorTotalDosDescontos > 0 ? 1 : 0;

  const observacaoCupom =
    `*** Pedido Keeta ${pedido.displayId} ***\n` +
    descontos.map((e) => `${e.name} ${toCurrency(e.price.value)}`).join("\n");

  const taxaServicoPadrao = 0;
  const guid = uuidv4();

  const result = await pool
    .request()
    .input("IDCliente", sql.Int, idCliente)
    .input("IDTipoPedido", sql.Int, 30)
    .input("IDStatusPedido", sql.Int, 60)
    .input("IDTipoDesconto", sql.Int, null)
    .input("IDTaxaEntrega", sql.Int, idTaxaEntrega)
    .input("GUIDIdentificacao", sql.NVarChar(50), guid)
    .input("GUIDMovimentacao", sql.NVarChar(50), uuidv4())
    .input("ValorDesconto", sql.Decimal(18, 2), 0)
    .input("ValorTotal", sql.Decimal(18, 2), valorTotal)
    .input("Observacoes", sql.NVarChar(sql.MAX), observacoes)
    .input("ValorEntrega", sql.Decimal(18, 2), valorDaEntrega)
    .input("AplicarDesconto", sql.Bit, 0)
    .input("ObservacaoCupom", sql.NVarChar(sql.MAX), observacaoCupom)
    .input("IDOrigemPedido", sql.Int, idOrigemPedido)
    .input("PermitirAlterar", sql.Bit, 0)
    .input("TaxaServicoPadrao", sql.Int, taxaServicoPadrao)
    .input("IDEntregador", sql.Int, idEntregador)
    .input("IDRetornoSAT_Venda", sql.Int, pedido.IDRetornoSAT_Venda || null)
    .query(`
          INSERT INTO [dbo].[tbPedido]
              ([IDCliente], [IDTipoPedido], [IDStatusPedido], [IDTipoDesconto], [IDTaxaEntrega], [GUIDIdentificacao], [GUIDMovimentacao], [DtPedido], [ValorDesconto], [ValorTotal], [Observacoes], [ValorEntrega], [AplicarDesconto], [ObservacaoCupom], [IDOrigemPedido], [PermitirAlterar], [IDEntregador], [TaxaServicoPadrao], [IDRetornoSAT_Venda])
          OUTPUT INSERTED.IDPedido
          VALUES
              (@IDCliente, @IDTipoPedido, @IDStatusPedido, @IDTipoDesconto, @IDTaxaEntrega, @GUIDIdentificacao, @GUIDMovimentacao, GetDate(), @ValorDesconto, @ValorTotal, @Observacoes, @ValorEntrega, @AplicarDesconto, @ObservacaoCupom, @IDOrigemPedido, @PermitirAlterar, @IDEntregador, @TaxaServicoPadrao, @IDRetornoSAT_Venda)
      `);

  const tags = [
    { chave: "keeta-orderId", valor: pedido.id },
    { chave: "keeta-shortReference", valor: pedido.displayId },
    { chave: "keeta-Type", valor: pedido.type },
    { chave: "keeta-status", valor: pedido.lastEvent },
  ];

  for (const tag of tags) {
    await criarTag({
      GUID: guid,
      chave: tag.chave,
      valor: tag.valor.toString(),
    });
  }

  console.log("✅ Tags do pedido adicionadas com sucesso.");
  return result.recordset[0].IDPedido;
};

const adicionarProdutos = async (pedido, idPedido) => {
  for (const item of pedido.items) {
    for (let i = 0; i < item.quantity; i++) {
      const produto = await carregarProduto(item);
      const idPedidoProduto = await adicionarPedidoProduto(
        idPedido,
        produto,
        null,
        item,
      );

      for (const options of item.options) {
        const produto = await carregarProduto(options);
        await adicionarPedidoProduto(
          idPedido,
          produto,
          idPedidoProduto,
          options,
        );
      }
    }
  }
};

const carregarProduto = async (item) => {
  let produto = {};

  if (item.externalId) {
    produto.idProduto = item.externalId;
    produto.observacao = item.specialInstructions;
  } else {
    produto.idProduto = 1;
    produto.observacao = `Não cadastrado: ${item.name}\n\n Instruçoes especiais:\n${item?.specialInstructions}`;
  }

  return produto;
};

const adicionarPedidoProduto = async (
  idPedido,
  produto,
  idPedidoProdutoPai,
  item,
) => {
  const pool = await getPool();

  let idPDV = null;
  const pdvResult = await pool.request().query(`
    SELECT TOP 1 Valor FROM tbConfiguracaoBD
    WHERE IDTipoPDV = 280 AND Chave = 'IDPDV'`);

  if (pdvResult.recordset.length > 0) {
    idPDV = pdvResult.recordset[0].Valor;
  } else {
    throw new Error("Nenhum IDPDV encontrado na tabela tbConfiguracaoBD.");
  }

  const idUsuario = 1;

  const notas = [produto.observacao].filter(Boolean).join(" ");

  const result = await pool
    .request()
    .input("IDPedido", sql.Int, idPedido)
    .input("IDProduto", sql.Int, produto.idProduto)
    .input("IDPedidoProduto_pai", sql.Int, idPedidoProdutoPai)
    .input("IDPDV", sql.Int, idPDV)
    .input("IDUsuario", sql.Int, idUsuario)
    .input("Quantidade", sql.Decimal(18, 3), 1)
    .input("ValorUnitario", sql.Decimal(18, 2), item.unitPrice.value)
    .input("Notas", sql.NVarChar(sql.MAX), notas)
    .input("Cancelado", sql.Bit, 0)
    .input("RetornarAoEstoque", sql.Bit, 0).query(`
      INSERT INTO tbPedidoProduto
        (IDPedido, IDProduto, IDPedidoProduto_pai, IDPDV, IDUsuario, Quantidade, ValorUnitario, Notas, DtInclusao, Cancelado, RetornarAoEstoque)
      OUTPUT INSERTED.IDPedidoProduto
      VALUES
        (@IDPedido, @IDProduto, @IDPedidoProduto_pai, @IDPDV, @IDUsuario, @Quantidade, @ValorUnitario, @Notas, GETDATE(), @Cancelado, @RetornarAoEstoque)
    `);

  return result.recordset[0].IDPedidoProduto;
};

const carregarTipoPagamento = async (pagamento) => {
  if (pagamento.type === "PREPAID") return config.tipoPagamento.keeta;
  if (pagamento.method === "CREDIT") return config.tipoPagamento.credito;
  if (pagamento.method === "DEBIT") return config.tipoPagamento.debito;
  if (pagamento.method === "CASH") return config.tipoPagamento.dinheiro;
  if (pagamento.method === "PIX") return config.tipoPagamento.pix;

  return config.tipoPagamento.outros;
};

const adicionarPedidoPagamento = async ({
  idPedido,
  tipoPagamento,
  valorDoPagamento,
}) => {
  const pool = await getPool();
  const idGateway =
    tipoPagamento.IDGateway === 0 ? null : tipoPagamento.IDGateway;

  await pool
    .request()
    .input("IDPedido", sql.Int, idPedido)
    .input("IDTipoPagamento", sql.Int, tipoPagamento.IDTipoPagamento)
    .input("IDUsuarioPagamento", sql.Int, config.usuario.IDUsuario)
    .input("Valor", sql.Decimal(18, 2), valorDoPagamento)
    .input("Excluido", sql.Bit, 0)
    .input("IDGateway", idGateway)
    .input("DataPagamento", sql.DateTime, new Date()).query(`
      INSERT INTO tbPedidoPagamento
        (IDPedido, IDTipoPagamento, IDUsuarioPagamento, Valor, Excluido, IDGateway, DataPagamento)
      VALUES
        (@IDPedido, @IDTipoPagamento, @IDUsuarioPagamento, @Valor, @Excluido, @IDGateway, @DataPagamento)
    `);

  return {
    name: tipoPagamento?.Nome,
    value: parseFloat(valorDoPagamento),
  };
};

const adicionarPagamentos = async (pedido, idPedido) => {
  const pagamentos = [];
  const valorTotal = calcularValorTotalDoPedido(pedido);

  const tipoPagamento = await carregarTipoPagamento(pedido.payments.methods[0]);
  const pagamentoInfo = await adicionarPedidoPagamento({
    idPedido,
    tipoPagamento,
    valorDoPagamento: valorTotal,
  });

  pagamentos.push(pagamentoInfo);
  return pagamentos;
};

const formatarTicket = (pedido, cliente, pagamentos) => {
  let ticket = ` *** Pedido Keeta ${pedido.displayId} ***\r\n`;
  ticket += `Data do Pedido: ${new Date(pedido.createdAt).toLocaleString()}\r\n`;
  ticket += `Cliente: ${cliente.name}\r\n`;
  ticket += `Telefone: (${cliente.phone.extension}) ${cliente.phone.number}\r\n`;
  ticket += `Endereço: ${pedido.delivery.deliveryAddress.formattedAddress}\r\n`;
  ticket += `Cidade: ${pedido.delivery.deliveryAddress.city} - ${pedido.delivery.deliveryAddress.state}\r\n`;
  ticket += `CEP: ${pedido.delivery.deliveryAddress.postalCode}\r\n`;
  ticket += `Complemento: ${pedido.delivery.deliveryAddress.complement}\r\n\r\n`;

  ticket += `Itens:\r\n`;
  pedido.items.forEach((item) => {
    ticket += `  - ${item.quantity} x ${item.name}: R$ ${item.totalPrice.value}\r\n`;
    if (item.observation) ticket += `    Observações: ${item.observation}\r\n`;

    //adicionar subitens ao ticket
    item.options.forEach((option) => {
      ticket += `    - ${option.quantity} x ${option.name}: R$ ${option.totalPrice.value}\r\n`;
      if (option.observation)
        ticket += `      Observações: ${option.observation}\r\n`;
    });
  });

  const tipoPagamento = pedido.payments.methods[0].method;
  const valorTotal = calcularValorTotalDoPedido(pedido);

  ticket += `\r\nTaxa de Entrega: R$ ${pedido.otherFees.find((f) => f.name === "DELIVERY_FEE")?.price?.value ?? 0}\r\n`;
  ticket += `\r\nPagamentos:\r\n`;
  ticket += `  - ${tipoPagamento} R$ ${valorTotal.toFixed(2)}\r\n`;
  ticket += `\r\nTotal: R$ ${valorTotal.toFixed(2)}\r\n`;

  return ticket;
};

const sincronisarStatus = async ({ pedido }) => {
  console.log("Sincronizando pedidos");
  try {
    const statusPdvInverted = {
      10: "aberto",
      20: "enviado",
      40: "finalizado",
      50: "cancelado",
      60: "nao-confirmado",
    };

    const statusPdvKeetaMap = {
      10: ["CONFIRMED"], // Aberto - Em produção
      20: ["DISPATCHED", "READY_FOR_PICKUP"], // Enviado - Pronto
      40: ["PICKED_UP", "DELIVERED", "CONCLUDED"], // Finalizado - Finalizado (Pedido concluído)
      50: [
        "CANCELLATION_REQUESTED",
        "CANCELLED",
        "USER_REFUND_REQUEST",
        "REFUNDED",
        "REFUND_FAILED",
      ], // Cancelado - Negado/Cancelado
      60: ["CREATED"], // Não confirmado - Em análise
    };

    const keetaTagId = await procurarTagGUIDChave({
      chave: "keeta-orderId",
      GUID: pedido.GUIDIdentificacao,
    });

    const detalhesDoPedidoKeeta = await keetaApi.get(
      `/orders/${keetaTagId.Valor}`,
    );

    const valorStatusPedidoKeeta = detalhesDoPedidoKeeta.data.lastEvent;
    const statusPedidoPDV7 = statusPdvInverted[pedido.IDStatusPedido];

    // verifica se o status do keeta esta diferente do pdv7
    if (
      !statusPdvKeetaMap[pedido.IDStatusPedido].includes(valorStatusPedidoKeeta)
    ) {
      console.log(
        `Sincronizando status pedido ${pedido.IDPedido}, Status keeta: ${valorStatusPedidoKeeta}, Status pdv: ${statusPedidoPDV7}`,
      );

      const pedidoKeetaNegadoOuCancelado = statusPdvKeetaMap[50].includes(
        valorStatusPedidoKeeta,
      );

      // Caso pedido esteja cancelado ou negado no keeta - cancela no PDV
      if (pedidoKeetaNegadoOuCancelado) {
        console.log(
          `Status pvd7 sendo alterado para cancelado, pedido: ${pedido.IDPedido}`,
        );

        await atualizarValorTag({
          chave: "keeta-status",
          GUID: pedido.GUIDIdentificacao,
          valor: valorStatusPedidoKeeta,
        });

        await atualizarStatusPedido({
          GUID: pedido.GUIDIdentificacao,
          IDStatusPedido: 50, // "cancelado"
        });

        return;
      }

      // if (
      //   valorStatusPedidoKeeta === "CONFIRMED" &&
      //   statusPedidoPDV7 === "nao-confirmado"
      // ) {
      //   console.log(
      //     "Status anotaai no pdvseven sendo alterado para 'em-producao'",
      //   );
      //   await atualizarValorTag({
      //     chave: "anotaai-status",
      //     GUID: pedido.GUIDIdentificacao,
      //     valor: valorStatusPedidoKeeta,
      //   });

      //   // await atualizarStatusPedido({ GUID: pedido.GUIDIdentificacao, IDStatusPedido: 60 });  // 10 corresponde a "nao conf"
      //   return;
      // }

      //   if (
      //     statusPedidoAnotaAi === "pronto" &&
      //     ["nao-confirmado", "aberto"].includes(statusPedidoPDV7)
      //   ) {
      //     // console.log("Status pvd7 sendo alterado para enviado");
      //     // await atualizarValorTag({ chave: "anotaai-status", GUID: pedido.GUIDIdentificacao, valor: valorStatusPedidoAnotaAi.toString() });
      //     // await atualizarStatusPedido({ GUID: pedido.GUIDIdentificacao, IDStatusPedido: 20 });  // 20 corresponde a "enviado"
      //     return;
      //   }

      //   if (
      //     statusPedidoAnotaAi === "finalizado" &&
      //     ["nao-confirmado", "aberto", "enviado"].includes(statusPedidoPDV7)
      //   ) {
      //     // console.log("Status pvd7 sendo alterado para finalizado")
      //     // await atualizarValorTag({ chave: "anotaai-status", GUID: pedido.GUIDIdentificacao, valor: valorStatusPedidoAnotaAi.toString() });
      //     // await atualizarStatusPedido({ GUID: pedido.GUIDIdentificacao, IDStatusPedido: 40 });  // 40 corresponde a finalizado
      //     return;
      //   }

      if (statusPedidoPDV7 === "aberto") {
        console.log("Confirmando pedido no keeta", pedido.IDPedido);
        await keetaApi.post(`/orders/${keetaTagId.Valor}/confirm`);

        await atualizarValorTag({
          GUID: pedido.GUIDIdentificacao,
          chave: "keeta-status",
          valor: "CONFIRMED",
        });

        return;
      }

      if (
        statusPedidoPDV7 === "enviado" &&
        detalhesDoPedidoKeeta.data.delivery.deliveredBy === "MERCHANT"
      ) {
        console.log("Enviando pedido no keeta - MERCHANT");
        await keetaApi.post(`/orders/${keetaTagId.Valor}/dispatch`, {
          deliveryTrackingInfo: {
            event: {
              type: "DELIVERY_ONGOING",
              message: "PEDIDO ENVIADO",
              datetime: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
            },
          },
        });

        await atualizarValorTag({
          GUID: pedido.GUIDIdentificacao,
          chave: "keeta-status",
          valor: "DISPATCHED",
        });

        return;
      }

      if (
        statusPedidoPDV7 === "enviado" &&
        detalhesDoPedidoKeeta.data.delivery.deliveredBy === "MARKETPLACE"
      ) {
        console.log("PEDIDO MARKTPLACE - READY FOR PICKUP");
        await keetaApi.post(`/orders/${keetaTagId.Valor}/readyForPickup`);

        await atualizarValorTag({
          GUID: pedido.GUIDIdentificacao,
          chave: "keeta-status",
          valor: "READY_FOR_PICKUP",
        });

        return;
      }

      if (
        statusPedidoPDV7 === "finalizado" &&
        detalhesDoPedidoKeeta.data.delivery.deliveredBy === "MERCHANT"
      ) {
        console.log("Finalizando pedido keeta");
        await keetaApi.post(`/orders/${keetaApi.Valor}/delivered`);
        await atualizarValorTag({
          GUID: pedido.GUIDIdentificacao,
          chave: "keeta-status",
          valor: "DELIVERED",
        });

        return;
      }

      if (statusPedidoPDV7 === "cancelado") {
        console.log("Cancelando pedido keeta", pedido.IDPedido);
        const motivo = await obterMotivoCancelamento({
          IDPedido: pedido.IDPedido,
        });

        const response = await keetaApi.post(
          `/orders/${keetaTagId.Valor}/requestCancellation`,
          {
            reason: motivo?.Nome ?? "Motivo não informado",
            code: "SYSTEMIC_ISSUES",
            mode: "AUTO",
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        await atualizarValorTag({
          GUID: pedido.GUIDIdentificacao,
          chave: "keeta-status",
          valor: "CANCELLED",
        });

        return;
      }
    }
  } catch (error) {
    console.log(
      error,
      "Ocorreu um erro ao sincronizar pedido",
      pedido.IDPedido,
    );
  }
};

module.exports = {
  inserirPedidoNoPDVSeven,
  sincronisarStatus,
};
