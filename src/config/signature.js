import crypto from "crypto";

export function generateSignature({ url, params = {}, body = null, secret }) {
  const baseUrl = url.split("?")[0];

  const queryString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("&");

  const bodyString = body ? JSON.stringify(body) : "";

  const stringToSign = [baseUrl, queryString, bodyString]
    .filter(Boolean)
    .join("&");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");

  return { signature, stringToSign };
}
