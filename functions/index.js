// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import logger from "firebase-functions/logger";

// Região padrão para evitar ambiguidade no emulador (pode mudar depois)
setGlobalOptions({ region: "us-central1", memory: "256MiB" });

// Função HTTP simples para validar o carregamento
export const ping = onRequest((req, res) => {
  logger.info("Functions OK");
  res.status(200).send("pong");
});
