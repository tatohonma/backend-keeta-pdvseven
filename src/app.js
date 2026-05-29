require("dotenv").config();
const express = require("express");
const { verificarConexao } = require("./config/db");
const { iniciarConfiguracoes } = require("./config/pdv7");

const app = express();
app.use(express.json());

app.use("/api", require("./routes"));

const PORT = process.env.PORT || 5102;
app.listen(PORT, async () => {
  try {
    console.log("Iniciando serviço...");
    console.log("Environment:", process.env.NODE_ENV);

    await verificarConexao();
    await iniciarConfiguracoes();

    console.log("");
    console.log(
      `Serviço de integração entre PDV7 e keeta disponível na porta ${PORT}`,
    );
    console.log("");
  } catch (error) {
    console.error("Erro ao iniciar serviço:", error);
  }
});
