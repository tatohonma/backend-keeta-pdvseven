const axios = require("axios");
const { generateSignature } = require("./signature");

let token = null;
let expirationDate = null;
const client_secret = process.env.KEETA_CLIENT_SECRET;

const keetaApi = axios.create({
  baseURL: "https://open.mykeeta.com/api/open/opendelivery/v1",
});

const refreshToken = async () => {
  const tokenUrl = "https://open.mykeeta.com/api/open/opendelivery/oauth/token";
  const response = await axios.post(tokenUrl, {
    grant_type: "client_credentials",
    client_id: process.env.KEETA_CLIENT_ID,
    client_secret,
  });

  token = response.data.access_token;
  expirationDate = Date.now() + response.data.expires_in * 1000;
};

keetaApi.interceptors.request.use(async (config) => {
  if (!token || Date.now() >= expirationDate) {
    await refreshToken();
  }

  const { signature } = generateSignature({
    url: config.baseURL + config.url,
    params: config.params,
    body: config.data,
    secret: client_secret,
  });

  config.headers.Authorization = `Bearer ${token}`;
  config.headers["X-App-Signature"] = signature;

  return config;
});

module.exports = { keetaApi };
