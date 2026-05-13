const { keetaApi } = require("../config/axios");

exports.buscarDetalhesDoPedido = async ({ id }) => {
  const response = await keetaApi.get(`/orders/${id}`);
  return response.data;
};

exports.confirmarPedido = async ({ id }) => {
  const response = await keetaApi.post(`/orders/${id}/confirm`);
  return response.data;
};

exports.despacharPedido = async ({ id }) => {
  const response = await keetaApi.post(`/orders/${id}/dispatch`, {
    deliveryTrackingInfo: {
      event: {
        type: "DELIVERY_ONGOING",
        message: "PEDIDO ENVIADO",
        datetime: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    },
  });

  return response.data;
};

exports.pedidoProntoParaEntrega = async ({ id }) => {
  const response = await keetaApi.post(`/orders/${id}/readyForPickup`);
  return response.data;
};

exports.finalizarPedido = async ({ id }) => {
  const response = await keetaApi.post(`/orders/${id}/delivered`);
  return response.data;
};

exports.cancelarPedido = async ({ id, motivo }) => {
  const response = await keetaApi.post(
    `/orders/${id}/requestCancellation`,
    {
      reason: motivo ?? "Motivo não informado",
      code: "SYSTEMIC_ISSUES",
      mode: "AUTO",
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  return response.data;
};
