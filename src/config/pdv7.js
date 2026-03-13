const { getPool } = require("./db");

let configuracoes = {
  usuario: null,
  pdv: null,
  tipoDesconto: null,
  tipoEntrega: null,
  entregador: null,
  tipoPagamento: {
    dinheiro: null,
    credito: null,
    debito: null,
    vr: null,
    pix: null,
    keeta: null,
    outros: null,
  },
};

const iniciarConfiguracoes = async () => {
  try {
    console.log("Iniciando configurações...");

    const pool = await getPool();

    let origemPedidoResult = await pool
      .request()
      .query(`SELECT * FROM tbOrigemPedido WHERE nome='keeta'`);
    if (origemPedidoResult.recordset.length === 0) {
      await pool
        .request()
        .query(`INSERT INTO tbOrigemPedido (nome) VALUES ('keeta')`);
      console.log("  - OrigemPedido adicionada com sucesso.");

      origemPedidoResult = await pool
        .request()
        .query(`SELECT * FROM tbOrigemPedido WHERE nome='keeta'`);
    }
    configuracoes.origemPedido = origemPedidoResult.recordset[0];
    console.log("  - OrigemPedido carregada");

    const idPDV = process.env.CAIXA_PDV || 1;
    const pdvResult = await pool
      .request()
      .query(`SELECT * FROM tbPDV WHERE idPDV=${idPDV}`);

    if (pdvResult.recordset.length === 0)
      throw "Erro ao carregar configurações: PDV não encontrado";

    configuracoes.pdv = pdvResult.recordset[0];
    console.log("  - PDV carregado:", configuracoes.pdv.Nome);

    const senha = process.env.CHAVE_ACESSO || "9933";
    const usuarioResult = await pool
      .request()
      .query(`SELECT * FROM tbUsuario WHERE senha='${senha}'`);

    if (usuarioResult.recordset.length === 0)
      throw "Erro ao carregar configurações: Usuário não encontrado";

    configuracoes.usuario = usuarioResult.recordset[0];
    console.log("  - Usuário carregado:", configuracoes.usuario.Nome);

    let tipoDescontoResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoDesconto WHERE nome='keeta'`);

    if (tipoDescontoResult.recordset.length === 0) {
      await pool
        .request()
        .query(
          `INSERT INTO tbTipoDesconto (nome, ativo, excluido) VALUES ('keeta', 1, 0)`,
        );
      console.log("  - TipoDesconto adicionado com sucesso.");
      tipoDescontoResult = await pool
        .request()
        .query(`SELECT * FROM tbTipoDesconto WHERE nome='keeta'`);
    }

    configuracoes.tipoDesconto = tipoDescontoResult.recordset[0];
    console.log("  - TipoDesconto carregado");

    // Carregar Entregador
    let entregadorResult = await pool
      .request()
      .query(`SELECT * FROM tbEntregador WHERE nome='keeta'`);

    if (entregadorResult.recordset.length === 0) {
      await pool
        .request()
        .query(
          `INSERT INTO tbEntregador (nome, ativo, excluido) VALUES ('keeta', 1, 0)`,
        );
      console.log("  - Entregador padrão adicionado com sucesso.");
      entregadorResult = await pool
        .request()
        .query(`SELECT * FROM tbEntregador WHERE nome='keeta'`);
    }
    configuracoes.entregador = entregadorResult.recordset[0];
    console.log("  - Entregador carregado");

    // Carregar Taxa Entrega
    let taxaEntregaResult = await pool
      .request()
      .query(`SELECT * FROM tbTaxaEntrega WHERE nome='keeta'`);

    if (taxaEntregaResult.recordset.length === 0) {
      await pool
        .request()
        .query(
          `INSERT INTO tbTaxaEntrega (nome, valor, ativo, excluido) VALUES ('keeta', 0, 1, 0)`,
        );
      console.log("  - TaxaEntrega adicionada com sucesso.");
      taxaEntregaResult = await pool
        .request()
        .query(`SELECT * FROM tbTaxaEntrega WHERE nome='keeta'`);
    }

    configuracoes.taxaEntrega = taxaEntregaResult.recordset[0];
    console.log("  - TaxaEntrega carregada");

    // Carregar Forma de Pagamento
    let tipoPagamentoResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE nome='keeta'`);

    if (tipoPagamentoResult.recordset.length === 0) {
      await pool.request().query(`INSERT INTO tbGateway
        (idGateway, nome) VALUES (7, 'keeta')`);

      await pool.request().query(`INSERT INTO tbTipoPagamento
        (nome, registrarValores, ativo, idMeioPagamentoSAT, idGateway) VALUES
        ('keeta', 0, 1, 10, 7)`);

      console.log("  - TipoPagamento adicionada com sucesso.");
      tipoPagamentoResult = await pool
        .request()
        .query(`SELECT * FROM tbTipoPagamento WHERE nome='keeta'`);
    }
    configuracoes.tipoPagamento.keeta = tipoPagamentoResult.recordset[0];
    console.log("  - TipoPagamento keeta carregada");

    const dinheiroResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE idMeioPagamentoSAT=1`);
    if (dinheiroResult.recordset.length === 0)
      throw "Erro ao carregar TipoPagamento Dinheiro";
    configuracoes.tipoPagamento.dinheiro = dinheiroResult.recordset[0];
    console.log("  - TipoPagamento Dinheiro carregada");

    const creditoResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE idMeioPagamentoSAT=3`);
    if (creditoResult.recordset.length === 0)
      throw "Erro ao carregar TipoPagamento Crédito";
    configuracoes.tipoPagamento.credito = creditoResult.recordset[0];
    console.log("  - TipoPagamento Crédito carregada");

    const debitoResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE idMeioPagamentoSAT=4`);
    if (debitoResult.recordset.length === 0)
      throw "Erro ao carregar TipoPagamento Débito";
    configuracoes.tipoPagamento.debito = debitoResult.recordset[0];
    console.log("  - TipoPagamento Débito carregada");

    let vrResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE idMeioPagamentoSAT=7`);
    if (vrResult.recordset.length === 0) {
      await pool.request().query(`INSERT INTO tbTipoPagamento
        (nome, CodigoImpressoraFiscal, registrarValores, ativo, idMeioPagamentoSAT) VALUES
        ('Vale Refeição', 0, 1, 1, 7)`);
      console.log("  - TipoPagamento Vale Refeição adicionada com sucesso.");
      vrResult = await pool
        .request()
        .query(`SELECT * FROM tbTipoPagamento WHERE idMeioPagamentoSAT=7`);
    }
    configuracoes.tipoPagamento.vr = vrResult.recordset[0];
    console.log("  - TipoPagamento VR carregada");

    let pixResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE nome='pix'`);
    if (pixResult.recordset.length === 0) {
      await pool.request().query(`INSERT INTO tbTipoPagamento
        (nome, CodigoImpressoraFiscal, registrarValores, ativo, idMeioPagamentoSAT) VALUES
        ('Pix', 0, 1, 1, 10)`);
      console.log("  - TipoPagamento Pix adicionada com sucesso.");
      pixResult = await pool
        .request()
        .query(`SELECT * FROM tbTipoPagamento WHERE nome='pix'`);
    }
    configuracoes.tipoPagamento.pix = pixResult.recordset[0];
    console.log("  - TipoPagamento PIX carregada");

    const outrosPagamentosResult = await pool
      .request()
      .query(`SELECT * FROM tbTipoPagamento WHERE idMeioPagamentoSAT=10`);
    if (outrosPagamentosResult.recordset.length === 0)
      throw "Erro ao carregar TipoPagamento Outros";
    configuracoes.tipoPagamento.outros = outrosPagamentosResult.recordset[0];
    console.log("  - TipoPagamento Outros carregada");

    console.log("Configurações carregadas com sucesso");
  } catch (error) {
    console.error("Erro ao configurar o sistema", error);
    throw "Erro ao configurar o sistema";
  }
};

const getConfiguracoes = () => configuracoes;

module.exports = { iniciarConfiguracoes, getConfiguracoes };
