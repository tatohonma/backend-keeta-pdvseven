const toCurrency = (num) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
};

module.exports = {
  toCurrency,
};
