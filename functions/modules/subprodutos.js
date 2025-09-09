// functions/modules/subprodutos.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { google } from "googleapis";

export const subProdutosRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const SPREADSHEET_ID = '1CFbP6_VC4TOJXITwO-nvxu6IX1brAYJNUCaRW0VDXDY';
const SHEET_NAME = 'SubProdutos';
const FIRESTORE_COLLECTION = 'subprodutos';

/**
 * Função utilitária para converter dados da planilha (array de arrays) para um array de objetos.
 */
function subprodutos_convertSheetDataToObject(data) {
    if (!data || data.length < 2) {
        return [];
    }
    const headers = data[0];
    const rows = data.slice(1);
    return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] || "";
        });
        return obj;
    });
}

// --- ROTAS DO MÓDULO SUBPRODUTOS ---

/**
 * Rota para importar dados de subprodutos DIRETO DO GOOGLE SHEETS para o Firestore.
 */
subProdutosRouter.post('/subprodutos/import', async (req, res) => {
    logger.info(`API: Recebida requisição para importar subprodutos da planilha: ${SHEET_NAME}`);
    try {
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
        });

        const data = response.data.values;
        if (!data || data.length === 0) {
            logger.warn("Nenhum dado encontrado na planilha de subprodutos.");
            return res.status(404).json({ success: false, message: "Nenhum dado encontrado na planilha." });
        }

        const subprodutos = subprodutos_convertSheetDataToObject(data);

        const db = admin.firestore();
        const batch = db.batch();

        let count = 0;
        subprodutos.forEach((subproduto) => {
            if (subproduto.ID) {
                const docRef = db.collection(FIRESTORE_COLLECTION).doc(String(subproduto.ID));
                batch.set(docRef, subproduto, { merge: true });
                count++;
            }
        });

        await batch.commit();

        logger.info(`API: ${count} subprodutos importados/atualizados com sucesso.`);
        res.status(200).json({ success: true, message: `${count} subprodutos importados/atualizados com sucesso!` });

    } catch (e) {
        logger.error("Erro ao importar subprodutos do Google Sheets:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para obter a lista de subprodutos de forma paginada e com filtro do Firestore.
 */
subProdutosRouter.post('/subprodutos/list', async (req, res) => {
    logger.info("API: Recebida requisição para listar subprodutos", { body: req.body });
    try {
        const { pagina = 1, itensPorPagina = 10, termoBusca = "" } = req.body;
        const db = admin.firestore();
        let query = db.collection(FIRESTORE_COLLECTION);

        const snapshot = await query.orderBy('SubProduto').get();
        if (snapshot.empty) {
            return res.status(200).json({
                cabecalhosParaExibicao: ["SubProduto", "Produto Vinculado", "Fornecedor", "Categoria", "UN", "Status"],
                subProdutosPaginados: [],
                totalItens: 0,
                paginaAtual: 1,
                totalPaginas: 1,
            });
        }

        let subProdutos = [];
        snapshot.forEach(doc => {
            subProdutos.push({ ID: doc.id, ...doc.data() });
        });

        let subProdutosFiltrados = subProdutos;
        if (termoBusca) {
            const termoNormalizado = termoBusca.toLowerCase().trim();
            subProdutosFiltrados = subProdutos.filter(sub =>
                Object.values(sub).some(val => String(val).toLowerCase().includes(termoNormalizado))
            );
        }

        const totalItens = subProdutosFiltrados.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPagina) || 1;
        const offset = (pagina - 1) * itensPorPagina;
        const subProdutosPaginados = subProdutosFiltrados.slice(offset, offset + itensPorPagina);

        const resposta = {
            cabecalhosParaExibicao: ["SubProduto", "Produto Vinculado", "Fornecedor", "Categoria", "UN", "Status"],
            subProdutosPaginados,
            totalItens,
            paginaAtual: pagina,
            totalPaginas,
        };
        res.status(200).json(resposta);
    } catch (e) {
        logger.error("Erro ao listar subprodutos:", e);
        res.status(500).json({ error: true, message: e.message });
    }
});

/**
 * Rota para obter a lista de todos os produtos para dropdowns.
 */
subProdutosRouter.get('/subprodutos/list-produtos', async (req, res) => {
    logger.info("API: Buscando lista de todos os produtos para dropdown.");
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('produtos').orderBy('Produto').get();
        const produtos = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            produtos.push({ ID: doc.id, Produto: data.Produto });
        });
        res.status(200).json(produtos);
    } catch (e) {
        logger.error("Erro ao listar produtos para dropdown:", e);
        res.status(500).json([]);
    }
});

/**
 * Rota para obter a lista de todos os fornecedores para dropdowns.
 */
subProdutosRouter.get('/subprodutos/list-fornecedores', async (req, res) => {
    logger.info("API: Buscando lista de todos os fornecedores para dropdown.");
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('fornecedores').orderBy('Fornecedor').get();
        const fornecedores = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            fornecedores.push({ ID: doc.id, Fornecedor: data.Fornecedor });
        });
        res.status(200).json(fornecedores);
    } catch (e) {
        logger.error("Erro ao listar fornecedores para dropdown:", e);
        res.status(500).json([]);
    }
});