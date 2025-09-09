// functions/modules/produtos.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { google } from "googleapis";
import { createRequire } from 'module';

export const produtosRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const SPREADSHEET_ID = '1CFbP6_VC4TOJXITwO-nvxu6IX1brAYJNUCaRW0VDXDY';
const SHEET_NAME = 'Produtos';
const FIRESTORE_COLLECTION = 'produtos';
const require = createRequire(import.meta.url);
const serviceAccountKey = require('../serviceAccountKey.json');

/**
 * Função utilitária para converter dados da planilha (array de arrays) para um array de objetos.
 */
function produtos_convertSheetDataToObject(data) {
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

// --- ROTAS DO MÓDULO PRODUTOS ---

/**
 * Rota para importar dados de produtos DIRETO DO GOOGLE SHEETS para o Firestore.
 */
produtosRouter.post('/produtos/import', async (req, res) => {
    logger.info(`API: Recebida requisição para importar produtos da planilha: ${SHEET_NAME}`);
    try {
        // Autenticação explícita com a chave da conta de serviço
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: serviceAccountKey.client_email,
                private_key: serviceAccountKey.private_key,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
        });

        const data = response.data.values;
        if (!data || data.length === 0) {
            logger.warn("Nenhum dado encontrado na planilha de produtos.");
            return res.status(404).json({ success: false, message: "Nenhum dado encontrado na planilha." });
        }

        const produtos = produtos_convertSheetDataToObject(data);

        const db = admin.firestore();
        const batch = db.batch();

        let count = 0;
        produtos.forEach((produto) => {
            if (produto.ID) {
                const docRef = db.collection(FIRESTORE_COLLECTION).doc(String(produto.ID));
                batch.set(docRef, produto, { merge: true });
                count++;
            }
        });

        await batch.commit();

        logger.info(`API: ${count} produtos importados/atualizados com sucesso.`);
        res.status(200).json({ success: true, message: `${count} produtos importados/atualizados com sucesso!` });

    } catch (e) {
        logger.error("Erro ao importar produtos do Google Sheets:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para obter a lista de produtos de forma paginada e com filtro do Firestore.
 */
produtosRouter.post('/produtos/list', async (req, res) => {
    logger.info("API: Recebida requisição para listar produtos", { body: req.body });
    try {
        const { pagina = 1, itensPorPagina = 10, termoBusca = "" } = req.body;
        const db = admin.firestore();
        let query = db.collection(FIRESTORE_COLLECTION);

        const snapshot = await query.orderBy('Produto').get();
        if (snapshot.empty) {
            return res.status(200).json({
                cabecalhosParaExibicao: ["Produto", "Tamanho", "UN", "Estoque Minimo", "Status"],
                produtosPaginados: [],
                totalItens: 0,
                paginaAtual: 1,
                totalPaginas: 1,
            });
        }

        let produtos = [];
        snapshot.forEach(doc => {
            produtos.push({ ID: doc.id, ...doc.data() });
        });

        let produtosFiltrados = produtos;
        if (termoBusca) {
            const termoNormalizado = termoBusca.toLowerCase().trim();
            produtosFiltrados = produtos.filter(produto =>
                Object.values(produto).some(val => String(val).toLowerCase().includes(termoNormalizado))
            );
        }

        const totalItens = produtosFiltrados.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPagina) || 1;
        const offset = (pagina - 1) * itensPorPagina;
        const produtosPaginados = produtosFiltrados.slice(offset, offset + itensPorPagina);

        const resposta = {
            cabecalhosParaExibicao: ["Produto", "Tamanho", "UN", "Estoque Minimo", "Status"],
            produtosPaginados,
            totalItens,
            paginaAtual: pagina,
            totalPaginas,
        };
        res.status(200).json(resposta);
    } catch (e) {
        logger.error("Erro ao listar produtos:", e);
        res.status(500).json({ error: true, message: e.message });
    }
});

/**
 * Rota para criar um novo produto no Firestore.
 */
produtosRouter.post('/produtos/create', async (req, res) => {
    logger.info("API: Recebida requisição para criar produto", { body: req.body });
    try {
        const dadosNovoProduto = req.body;
        if (!dadosNovoProduto || !dadosNovoProduto["Produto"]) {
            return res.status(400).json({ error: true, success: false, message: "O campo 'Produto' é obrigatório." });
        }

        const db = admin.firestore();
        const novoProdutoRef = db.collection(FIRESTORE_COLLECTION).doc();
        const novoProduto = {
            ...dadosNovoProduto,
            ID: novoProdutoRef.id,
            "Data de Cadastro": new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        };
        delete novoProduto.ID_do_Form; // Remover campo auxiliar se houver

        await novoProdutoRef.set(novoProduto);

        res.status(201).json({ success: true, message: "Produto criado com sucesso!", novoId: novoProdutoRef.id });
    } catch (e) {
        logger.error("Erro ao criar produto:", e);
        res.status(500).json({ error: true, success: false, message: e.message });
    }
});

/**
 * Rota para atualizar um produto existente no Firestore.
 */
produtosRouter.post('/produtos/update', async (req, res) => {
    logger.info("API: Recebida requisição para atualizar produto", { body: req.body });
    try {
        const dadosProdutoAtualizar = req.body;
        const { ID } = dadosProdutoAtualizar;
        if (!ID) {
            return res.status(400).json({ error: true, success: false, message: "ID do produto é obrigatório." });
        }

        const db = admin.firestore();
        const produtoRef = db.collection(FIRESTORE_COLLECTION).doc(String(ID));

        delete dadosProdutoAtualizar.ID;
        await produtoRef.update(dadosProdutoAtualizar);

        res.status(200).json({ success: true, message: "Produto atualizado com sucesso!" });
    } catch (e) {
        logger.error("Erro ao atualizar produto:", e);
        res.status(500).json({ error: true, success: false, message: e.message });
    }
});


/**
 * Rota para obter todos os fornecedores (usado no modal de subprodutos).
 */
produtosRouter.get('/produtos/getAllFornecedores', async (req, res) => {
    logger.info(`API: Buscando lista de todos os fornecedores.`);
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('fornecedores').get();
        const fornecedores = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            fornecedores.push({ id: doc.id, nome: data.Fornecedor });
        });
        res.status(200).json(fornecedores);
    } catch (e) {
        logger.error("Erro ao buscar fornecedores:", e);
        res.status(500).json([]);
    }
});