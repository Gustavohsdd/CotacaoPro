// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";

// Importa os roteadores dos módulos
import { fornecedoresRouter } from "./fornecedores.js";

// Inicializa o Firebase Admin SDK
admin.initializeApp();

// Define a região padrão para as funções
setGlobalOptions({ region: "us-central1", memory: "256MiB" });

const app = express();

// Aplica o middleware do CORS para permitir requisições do frontend
// É uma boa prática aplicar o CORS antes das rotas
app.use(cors({ origin: true }));

// Este middleware é essencial para que o Express consiga interpretar o corpo (body) de requisições JSON.
app.use(express.json());

// --- ROTAS DA API ---
// Usa os roteadores dos módulos. Todas as rotas definidas em fornecedores.js
// agora estarão disponíveis sob o prefixo /api
app.use('/api', fornecedoresRouter);
// Futuramente, você adicionará outros aqui:
// import { produtosRouter } from "./produtos.js";
// app.use('/api', produtosRouter);


// Exporta a aplicação Express como uma única Cloud Function chamada "api"
export const api = onRequest(app);