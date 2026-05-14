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
const {
  buscarDetalhesDoPedido,
  confirmarPedido,
  despacharPedido,
  finalizarPedido,
  cancelarPedido,
  pedidoProntoParaEntrega,
} = require("./api/pedido");
const { STATUS_PDV_MAP, PDV_KEETA_MAP } = require("./constants");

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

const adicionarPedido = async (pedido, idCliente) => {
  const pool = await getPool();

  const idTipoDesconto = config.tipoDesconto.IDTipoDesconto;
  const idTaxaEntrega = config.taxaEntrega.IDTaxaEntrega;
  const idOrigemPedido = config.origemPedido.IDOrigemPedido;
  const idEntregador = config.entregador.IDEntregador;

  const valorDaEntrega =
    pedido.otherFees.find((f) => f.name === "DELIVERY_FEE")?.price?.value ?? 0;

  const valorDescontos = pedido.discounts.reduce(
    (acc, cur) => acc + cur.amount.value,
    0,
  );

  const valorTotal =
    pedido.total.itemsPrice.value + valorDaEntrega - valorDescontos;

  const observacoes = "";

  const observacaoOtherFees = pedido.otherFees
    .filter((f) => !["DELIVERY_FEE"].includes(f.name))
    .map((e) => `${e.name} ${toCurrency(e.price.value)}`)
    .join("\n");

  const observacaoDesconto = pedido.discounts
    .flatMap((d) =>
      d.sponsorshipValues.map((s) => `${s.name} ${toCurrency(s.amount.value)}`),
    )
    .join("\n");

  const observacaoCupom =
    `*** Pedido Keeta ${pedido.displayId} ***\n` +
    observacaoOtherFees +
    "\n" +
    observacaoDesconto;

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
    .input("ValorDesconto", sql.Decimal(18, 2), null)
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

  const valorDaEntrega =
    pedido.otherFees.find((f) => f.name === "DELIVERY_FEE")?.price?.value ?? 0;

  const valorDescontos = pedido.discounts.reduce(
    (acc, cur) => acc + cur.amount.value,
    0,
  );

  const valorTotal =
    pedido.total.itemsPrice.value + valorDaEntrega - valorDescontos;

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

  const valorDaEntrega =
    pedido.otherFees.find((f) => f.name === "DELIVERY_FEE")?.price?.value ?? 0;

  const valorDescontos = pedido.discounts.reduce(
    (acc, cur) => acc + cur.amount.value,
    0,
  );

  const valorTotal =
    pedido.total.itemsPrice.value + valorDaEntrega - valorDescontos;

  ticket += `\r\nTaxa de Entrega: R$ ${valorDaEntrega}\r\n`;
  ticket += `\r\nDesconsto: R$ ${valorDescontos}\r\n`;

  ticket += `\r\nPagamentos:\r\n`;
  ticket += `  - ${tipoPagamento} R$ ${valorTotal.toFixed(2)}\r\n`;
  ticket += `\r\nTotal: R$ ${valorTotal.toFixed(2)}\r\n`;

  return ticket;
};

const sincronisarStatus = async ({ pedido }) => {
  try {
    const GUID = pedido.GUIDIdentificacao;
    const idPedidoPDV = pedido.IDPedido;

    const { Valor: idPedidoKeeta } = await procurarTagGUIDChave({
      chave: "keeta-orderId",
      GUID,
    });

    const detalhesPedidoKeeta = await buscarDetalhesDoPedido({
      id: idPedidoKeeta,
    });

    const statusPedidoKeeta = detalhesPedidoKeeta.lastEvent;
    const metodoEntrega = detalhesPedidoKeeta.delivery.deliveredBy;
    const statusPedidoPDV = pedido.IDStatusPedido;

    const statusPedidoIgual =
      PDV_KEETA_MAP[statusPedidoPDV].includes(statusPedidoKeeta);

    if (!statusPedidoIgual) {
      console.log(`--- Status do pedido ${idPedidoPDV} sendo sincronizado!`);
      console.log(
        `    [KEETA]: ${statusPedidoKeeta}, [PDV]: ${STATUS_PDV_MAP[statusPedidoPDV]}`,
      );

      const pedidoCanceladoKeeta =
        PDV_KEETA_MAP[50].includes(statusPedidoKeeta);

      if (pedidoCanceladoKeeta) {
        await atualizarValorTag({
          chave: "keeta-status",
          valor: statusPedidoKeeta,
          GUID,
        });

        await atualizarStatusPedido({
          IDStatusPedido: 50,
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'cancelado' PDV`);
        return;
      }

      const pedidoConfirmadoKeeta = statusPedidoKeeta === "CONFIRMED";
      const pedidoNaoConfimadoPdv =
        STATUS_PDV_MAP[statusPedidoPDV] === "nao-confirmado";

      if (pedidoConfirmadoKeeta && pedidoNaoConfimadoPdv) {
        await atualizarValorTag({
          chave: "keeta-status",
          valor: statusPedidoKeeta,
          GUID,
        });

        await atualizarStatusPedido({
          IDStatusPedido: 10,
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'confirmado' PDV`);
        return;
      }

      const pedidoProntoKeeta = PDV_KEETA_MAP[20].includes(statusPedidoKeeta);
      const pedidoNaoConfimadoOuAbertoPDV = [
        "nao-confirmado",
        "aberto",
      ].includes(STATUS_PDV_MAP[statusPedidoPDV]);

      if (pedidoProntoKeeta && pedidoNaoConfimadoOuAbertoPDV) {
        await atualizarValorTag({
          chave: "keeta-status",
          valor: statusPedidoKeeta,
          GUID,
        });

        await atualizarStatusPedido({
          IDStatusPedido: 20,
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'enviado' PDV`);
        return;
      }

      const pedidoFinalizadoKeeta =
        PDV_KEETA_MAP[40].includes(statusPedidoKeeta);
      const pedidoNaoConfimadoAbertoOuEnviadoPDV = [
        "nao-confirmado",
        "aberto",
        "enviado",
      ].includes(STATUS_PDV_MAP[statusPedidoPDV]);

      if (pedidoFinalizadoKeeta && pedidoNaoConfimadoAbertoOuEnviadoPDV) {
        await atualizarValorTag({
          chave: "keeta-status",
          valor: statusPedidoKeeta,
          GUID,
        });

        await atualizarStatusPedido({
          IDStatusPedido: 40,
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'finalizado' PDV`);
        return;
      }

      const pedidoAbertoPDV = STATUS_PDV_MAP[statusPedidoPDV] === "aberto";
      if (pedidoAbertoPDV) {
        await confirmarPedido({ id: idPedidoKeeta });

        await atualizarValorTag({
          chave: "keeta-status",
          valor: "CONFIRMED",
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'confirmado' KEETA`);
        return;
      }

      const pedidoEndiadoPDV = STATUS_PDV_MAP[statusPedidoPDV] === "enviado";
      const entregaLocal = metodoEntrega === "MERCHANT";
      const entregaKeeta = metodoEntrega === "MARKETPLACE";

      if (pedidoEndiadoPDV && entregaLocal) {
        await despacharPedido({ id: idPedidoKeeta });

        await atualizarValorTag({
          chave: "keeta-status",
          valor: "DISPATCHED",
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'despachado' KEETA`);
        return;
      }

      if (pedidoEndiadoPDV && entregaKeeta) {
        await pedidoProntoParaEntrega({ id: idPedidoKeeta });

        await atualizarValorTag({
          chave: "keeta-status",
          valor: "READY_FOR_PICKUP",
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'pronto para entrega' KEETA`);
        return;
      }

      const pedidoFinalizadoPDV =
        STATUS_PDV_MAP[statusPedidoPDV] === "finalizado";

      if (pedidoFinalizadoPDV && entregaLocal) {
        await finalizarPedido({ id: idPedidoKeeta });

        await atualizarValorTag({
          chave: "keeta-status",
          valor: "DELIVERED",
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'entregue' KEETA`);
        return;
      }

      const pedidoCanceladoPDV =
        STATUS_PDV_MAP[statusPedidoPDV] === "cancelado";

      if (pedidoCanceladoPDV) {
        const { Nome: motivoCancelamento } = await obterMotivoCancelamento({
          IDPedido: pedido.IDPedido,
        });

        await cancelarPedido({ id: idPedidoKeeta, motivo: motivoCancelamento });

        await atualizarValorTag({
          chave: "keeta-status",
          valor: "CANCELLED",
          GUID,
        });

        console.log(`    [PEDIDO: ${idPedidoPDV}] 'cancelado' KEETA`);
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
