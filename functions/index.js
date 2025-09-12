// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";

// Importa os roteadores dos módulos
import { fornecedoresRouter } from "./modules/fornecedores.js";
import { produtosRouter } from "./modules/produtos.js";
import { subProdutosRouter } from "./modules/subprodutos.js";
import { cotacoesRouter } from "./modules/cotacoes.js";
import { cotacaoindividualRouter } from "./modules/cotacaoindividual.js";

// Inicializa o Firebase Admin SDK
admin.initializeApp();

// Define a região padrão para as funções
// Nota: setGlobalOptions se aplica a TODAS as funções. Vamos sobrescrever para a API.
setGlobalOptions({ region: "us-central1" });

const app = express();

// Aplica o middleware do CORS para permitir requisições do frontend
app.use(cors({ origin: true }));

// Este middleware é essencial para que o Express consiga interpretar o corpo (body) de requisições JSON.
app.use(express.json());

// --- ROTAS DA API ---
// Usa os roteadores dos módulos. Todas as rotas definidas em seus respectivos arquivos
// agora estarão disponíveis sob o prefixo /api
app.use('/api', fornecedoresRouter);
app.use('/api', produtosRouter);
app.use('/api', subProdutosRouter);
app.use('/api', cotacoesRouter);
app.use('/api', cotacaoindividualRouter);


// Exporta a aplicação Express como uma única Cloud Function chamada "api"
// Aumentamos o timeout para 540 segundos (9 minutos) e a memória para 1GiB
// APENAS para a função 'api', que lida com a importação.
export const api = onRequest(
  {
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  app
);