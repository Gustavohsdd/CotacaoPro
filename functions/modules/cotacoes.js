// functions/modules/cotacoes.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { google } from "googleapis";
import { createRequire } from 'module';

export const cotacoesRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const SPREADSHEET_ID = '1CFbP6_VC4TOJXITwO-nvxu6IX1brAYJNUCaRW0VDXDY';
const require = createRequire(import.meta.url);
const serviceAccountKey = require('../serviceAccountKey.json');

// Nomes das coleções do Firestore
const PRODUTOS_COLLECTION = 'produtos';
const SUBPRODUTOS_COLLECTION = 'subprodutos';
const FORNECEDORES_COLLECTION = 'fornecedores';
const COTACOES_COLLECTION = 'cotacoes';

/**
 * Função utilitária para converter dados da planilha (array de arrays) para um array de objetos.
 */
function cotacoes_convertSheetDataToObject(data) {
    if (!data || data.length < 2) {
        return [];
    }
    const headers = data[0];
    const rows = data.slice(1);
    return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] !== undefined && row[index] !== null ? row[index] : "";
        });
        return obj;
    });
}

// --- ROTAS DO MÓDULO COTAÇÕES ---

/**
 * Rota para importar dados de cotações DIRETO DO GOOGLE SHEETS para o Firestore.
 */
cotacoesRouter.post('/cotacoes/import', async (req, res) => {
    const SHEET_NAME = 'Cotacoes'; // Nome da aba da planilha
    logger.info(`API: Recebida requisição para importar cotações da planilha: ${SHEET_NAME}`);
    try {
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
            logger.warn(`Nenhum dado encontrado na planilha de cotações.`);
            return res.status(404).json({ success: false, message: "Nenhum dado encontrado na planilha." });
        }

        const cotacoesItens = cotacoes_convertSheetDataToObject(data);

        const db = admin.firestore();
        const batch = db.batch();
        let count = 0;
        
        // Cada linha na planilha é um item de uma cotação. Usaremos um ID único para cada linha.
        cotacoesItens.forEach((item, index) => {
            // Criamos um ID de documento único para cada item da cotação
            const docId = `COT${String(item["ID da Cotação"]).padStart(4, '0')}-ITEM${String(index + 1).padStart(4, '0')}`;
            const docRef = db.collection(COTACOES_COLLECTION).doc(docId);
            batch.set(docRef, item, { merge: true });
            count++;
        });

        await batch.commit();

        logger.info(`API: ${count} itens de cotação importados/atualizados com sucesso.`);
        res.status(200).json({ success: true, message: `${count} itens de cotação importados/atualizados com sucesso!` });

    } catch (e) {
        logger.error("Erro ao importar cotações do Google Sheets:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para obter os resumos de cotações do Firestore.
 */
cotacoesRouter.get('/cotacoes/resumos', async (req, res) => {
    logger.info("API: Recebida requisição para obter resumos de cotações.");
    try {
        const db = admin.firestore();
        const snapshot = await db.collection(COTACOES_COLLECTION).get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, dados: [], message: "Nenhuma cotação encontrada." });
        }

        const cotacoesUnicas = {};

        snapshot.forEach(doc => {
            const item = doc.data();
            const idCotacao = item["ID da Cotação"];
            if (!idCotacao) return;

            if (!cotacoesUnicas[idCotacao]) {
                cotacoesUnicas[idCotacao] = {
                    ID_da_Cotacao: idCotacao,
                    Data_Abertura_Formatada: item["Data Abertura"] ? new Date(item["Data Abertura"]).toLocaleDateString('pt-BR') : "N/A",
                    Status_da_Cotacao: item["Status da Cotação"] || "Status Desconhecido",
                    Categorias: new Set()
                };
            }
            if (item.Categoria) {
                cotacoesUnicas[idCotacao].Categorias.add(item.Categoria);
            }
        });

        const arrayDeResumos = Object.values(cotacoesUnicas).map(cotacao => ({
            ...cotacao,
            Categorias_Unicas_String: Array.from(cotacao.Categorias).join(', ')
        }));

        res.status(200).json({ success: true, dados: arrayDeResumos });

    } catch (e) {
        logger.error("Erro ao obter resumos de cotações:", e);
        res.status(500).json({ success: false, dados: null, message: e.message });
    }
});

/**
 * Rota para obter as opções para criar uma nova cotação do Firestore.
 */
cotacoesRouter.get('/cotacoes/opcoes-nova-cotacao', async (req, res) => {
    logger.info("API: Recebida requisição para obter opções de nova cotação.");
    try {
        const db = admin.firestore();
        
        // Buscar Categorias (distintas de Produtos)
        const produtosSnap = await db.collection(PRODUTOS_COLLECTION).get();
        const categoriasSet = new Set();
        produtosSnap.forEach(doc => {
            const categoria = doc.data().Categoria;
            if (categoria) categoriasSet.add(categoria);
        });

        // Buscar Fornecedores
        const fornecedoresSnap = await db.collection(FORNECEDORES_COLLECTION).get();
        const fornecedores = [];
        fornecedoresSnap.forEach(doc => {
            fornecedores.push({ id: doc.id, nome: doc.data().Fornecedor });
        });

        // Buscar Produtos
        const produtos = [];
        produtosSnap.forEach(doc => {
            produtos.push({ id: doc.id, nome: doc.data().Produto });
        });
        
        res.status(200).json({
            success: true,
            dados: {
                categorias: Array.from(categoriasSet).sort(),
                fornecedores: fornecedores.sort((a,b) => a.nome.localeCompare(b.nome)),
                produtos: produtos.sort((a,b) => a.nome.localeCompare(b.nome))
            }
        });
    } catch (e) {
        logger.error("Erro ao obter opções para nova cotação:", e);
        res.status(500).json({ success: false, dados: null, message: e.message });
    }
});

/**
 * Rota para criar uma nova cotação no Firestore.
 */
cotacoesRouter.post('/cotacoes/criar', async (req, res) => {
    logger.info("API: Recebida requisição para criar nova cotação.", { body: req.body });
    const { tipo, selecoes } = req.body;

    if (!tipo || !selecoes || !Array.isArray(selecoes) || selecoes.length === 0) {
        return res.status(400).json({ success: false, message: "Opções de criação inválidas ou incompletas." });
    }

    try {
        const db = admin.firestore();
        
        // Gerar novo ID de cotação
        const cotacoesSnap = await db.collection(COTACOES_COLLECTION).orderBy("ID da Cotação", "desc").limit(1).get();
        let proximoId = 1;
        if (!cotacoesSnap.empty) {
            proximoId = Number(cotacoesSnap.docs[0].data()["ID da Cotação"]) + 1;
        }

        // Buscar todos os produtos e subprodutos para filtrar na memória
        const produtosSnap = await db.collection(PRODUTOS_COLLECTION).get();
        const subprodutosSnap = await db.collection(SUBPRODUTOS_COLLECTION).get();
        const todosProdutos = produtosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const todosSubProdutos = subprodutosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const produtosMap = new Map(todosProdutos.map(p => [p.Produto, p]));
        const selecoesLowerCase = selecoes.map(s => String(s).toLowerCase());
        let subProdutosFiltrados = [];
        
        // Lógica de filtragem
        if (tipo === 'categoria') {
            const nomesProdutos = new Set(todosProdutos
                .filter(p => p.Categoria && selecoesLowerCase.includes(String(p.Categoria).toLowerCase()))
                .map(p => String(p.Produto).toLowerCase()));
            subProdutosFiltrados = todosSubProdutos.filter(sp => nomesProdutos.has(String(sp["Produto Vinculado"]).toLowerCase()));
        } else if (tipo === 'fornecedor') {
            subProdutosFiltrados = todosSubProdutos.filter(sp => sp.Fornecedor && selecoesLowerCase.includes(String(sp.Fornecedor).toLowerCase()));
        } else if (tipo === 'curvaABC') {
            const nomesProdutos = new Set(todosProdutos
                .filter(p => p.ABC && selecoesLowerCase.includes(String(p.ABC).toLowerCase()))
                .map(p => String(p.Produto).toLowerCase()));
            subProdutosFiltrados = todosSubProdutos.filter(sp => nomesProdutos.has(String(sp["Produto Vinculado"]).toLowerCase()));
        } else if (tipo === 'produtoEspecifico') {
             subProdutosFiltrados = todosSubProdutos.filter(sp => sp["Produto Vinculado"] && selecoesLowerCase.includes(String(sp["Produto Vinculado"]).toLowerCase()));
        }

        if (subProdutosFiltrados.length === 0) {
            return res.status(200).json({ success: true, idCotacao: proximoId, numItens: 0, message: "Nenhum subproduto encontrado para os critérios. Cotação criada vazia." });
        }

        const batch = db.batch();
        const dataAbertura = new Date();
        const STATUS_NOVA_COTACAO = "Nova Cotação";

        subProdutosFiltrados.forEach((subProd, index) => {
            const produtoPrincipal = produtosMap.get(subProd["Produto Vinculado"]);
            const novoItemRef = db.collection(COTACOES_COLLECTION).doc(); // Gera ID automático para o item
            
            const novoItem = {
                "ID da Cotação": proximoId,
                "Data Abertura": dataAbertura.toISOString(),
                "Produto": subProd["Produto Vinculado"] || "",
                "SubProduto": subProd.SubProduto || "",
                "Categoria": (produtoPrincipal ? produtoPrincipal.Categoria : subProd.Categoria) || "",
                "Fornecedor": subProd.Fornecedor || "",
                "Tamanho": subProd.Tamanho || "",
                "UN": subProd.UN || "",
                "Fator": subProd.Fator || "",
                "Estoque Mínimo": (produtoPrincipal ? produtoPrincipal["Estoque Minimo"] : "") || "",
                "NCM": subProd.NCM || "",
                "CST": subProd.CST || "",
                "CFOP": subProd.CFOP || "",
                "Status da Cotação": STATUS_NOVA_COTACAO,
            };
            batch.set(novoItemRef, novoItem);
        });

        await batch.commit();

        res.status(201).json({
            success: true,
            idCotacao: proximoId,
            numItens: subProdutosFiltrados.length,
            message: `Nova cotação (ID: ${proximoId}) criada com ${subProdutosFiltrados.length} item(ns).`
        });

    } catch (e) {
        logger.error("Erro ao criar nova cotação:", e);
        res.status(500).json({ success: false, message: `Erro no servidor: ${e.message}` });
    }
});

