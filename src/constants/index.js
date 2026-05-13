exports.STATUS_PDV_MAP = {
  10: "aberto",
  20: "enviado",
  40: "finalizado",
  50: "cancelado",
  60: "nao-confirmado",
};

exports.PDV_KEETA_MAP = {
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
