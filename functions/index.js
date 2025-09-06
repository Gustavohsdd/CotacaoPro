// functions/index.js
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { join } from "path";

// Inicializa o Firebase Admin SDK
admin.initializeApp();

// Define a região padrão para as funções
setGlobalOptions({ region: "us-central1", memory: "256MiB" });

const app = express();

// Aplica o middleware do CORS para permitir requisições do frontend
app.use(cors({ origin: true }));

// --- Constantes e Mapeamentos (Migrados de App.js) ---

const index_VIEWS_PERMITIDAS = ["fornecedores", "produtos", "subprodutos", "cotacoes", "cotacaoIndividual",
  "contagemdeestoque", "EnviarManualmenteView", "marcarprodutos", "conciliacaonf", "rateionf", "relatoriorateio", "notasfiscais"];

const index_VIEW_FILENAME_MAP = {
  "fornecedores": "FornecedoresView.html",
  "produtos": "ProdutosView.html",
  "subprodutos": "SubProdutosView.html",
  "cotacoes": "CotacoesView.html",
  "cotacaoIndividual": "CotacaoIndividualView.html",
  "contagemdeestoque": "ContagemDeEstoqueView.html",
  "EnviarManualmenteView": "EnviarManualmenteView.html",
  "marcarprodutos": "MarcacaoProdutosView.html",
  "conciliacaonf": "ConciliacaoNFView.html",
  "rateionf": "RateioNFView.html",
  "relatoriorateio": "RelatorioRateioView.html",
  "notasfiscais": "NotasFiscaisView.html"
};

// --- Funções Auxiliares ---

/**
 * Lê o conteúdo de um arquivo de view HTML.
 * No GAS, isso era feito com HtmlService. No Firebase, lemos diretamente do sistema de arquivos.
 * @param {string} viewName O nome da view a ser carregada.
 * @return {string} O conteúdo HTML da view ou uma mensagem de erro.
 */
function index_getViewContent(viewName) {
  if (!index_VIEWS_PERMITIDAS.includes(viewName)) {
    logger.error("Tentativa de acesso a view inválida: " + viewName);
    return `<div class="error-message p-4">View inválida solicitada: ${viewName}</div>`;
  }

  const nomeArquivoHtml = index_VIEW_FILENAME_MAP[viewName];
  if (!nomeArquivoHtml) {
    logger.error("Mapeamento de nome de arquivo não encontrado para a view: " + viewName);
    return `<div class="error-message p-4">Configuração interna de view não encontrada para: ${viewName}</div>`;
  }

  try {
    // IMPORTANTE: Crie uma pasta 'views' dentro da pasta 'public'
    // e coloque seus arquivos HTML lá. A função os lerá a partir do diretório de execução.
    // Como a função roda a partir de 'functions', precisamos voltar um nível e entrar em 'public'.
    const filePath = join(process.cwd(), `../public/views/${nomeArquivoHtml}`);
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    logger.error(`Erro ao carregar o arquivo HTML '${nomeArquivoHtml}' para a view '${viewName}': ${error.toString()}`);
    // Retorna um HTML de placeholder se o arquivo não for encontrado
    return `
      <div class="p-4">
        <h2 class="text-2xl font-semibold mb-2">View: ${viewName}</h2>
        <p class="text-gray-600">Conteúdo para esta view ainda não foi criado.</p>
        <div class="mt-4 p-4 border-l-4 border-yellow-400 bg-yellow-50">
          <p class="font-bold">Atenção Desenvolvedor:</p>
          <p>Crie o arquivo <code class="bg-gray-200 p-1 rounded">${nomeArquivoHtml}</code> dentro da pasta <code class="bg-gray-200 p-1 rounded">public/views/</code>.</p>
        </div>
      </div>
    `;
  }
}

// --- Rotas da API ---

/**
 * Rota para obter o conteúdo HTML de uma view específica.
 * Substitui a função App_obterView do GAS.
 */
app.get('/api/view/:viewName', (req, res) => {
  const { viewName } = req.params;
  logger.info(`Requisição recebida para a view: ${viewName}`);
  const htmlContent = index_getViewContent(viewName);
  res.status(200).send(htmlContent);
});

/**
 * Rota para obter as constantes do projeto.
 * Substitui a função App_obterConstantes do GAS.
 */
app.get('/api/constants', (req, res) => {
    logger.info("Rota /api/constants chamada.");
    try {
        // Simulação das constantes que estavam no seu ambiente GAS
        const CABECALHOS_COTACOES = ["ID", "Nome", "Data", "Status"];
        const COLUNAS_PARA_ABA_SUBPRODUTOS = ["ID Produto", "Nome Subproduto", "Preço"];

        const constantesParaCliente = {
            CABECALHOS_COTACOES: CABECALHOS_COTACOES,
            COLUNAS_PARA_ABA_SUBPRODUTOS: colunasParaCliente
        };
        res.status(200).json(constantesParaCliente);
    } catch (e) {
        logger.error("Erro em /api/constants: " + e.toString());
        res.status(500).json({ error: true, message: "Erro ao obter constantes: " + e.message });
    }
});

/**
 * Rota para obter dados do portal do fornecedor.
 * Substitui a lógica de token da função doGet do GAS.
 */
app.get('/api/portal/:token', (req, res) => {
    const { token } = req.params;
    logger.info(`Buscando dados para o portal com o token: ${token}`);

    // AQUI VOCÊ DEVE ADICIONAR A LÓGICA PARA VALIDAR O TOKEN E BUSCAR OS DADOS NO FIRESTORE
    // Esta é uma simulação da resposta que sua função PortalController_... retornaria.
    const dadosPortalSimulados = {
        valido: true,
        nomeFornecedor: "Fornecedor Exemplo",
        idCotacao: "COT-12345",
        produtos: [{id: 1, nome: "Produto A"}, {id: 2, nome: "Produto B"}],
        status: "Aberta",
        pedidoFinalizado: false,
        dataAberturaFormatada: "01/01/2025"
    };

    if (!dadosPortalSimulados.valido) {
        return res.status(404).json({ valido: false, mensagemErro: "Token inválido ou cotação não encontrada." });
    }

    res.status(200).json(dadosPortalSimulados);
});


// Exporta a aplicação Express como uma única Cloud Function chamada "api"
export const api = onRequest(app);