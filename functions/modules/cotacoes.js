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
 * Converte a string de data da planilha para um objeto Date do JavaScript.
 * Formato esperado: 'DD/MM/AAAA HH:mm' ou 'DD/MM/AAAA'
 * ESTA FUNÇÃO FOI ATUALIZADA PARA TRATAR O FORMATO DE DATA BRASILEIRO (DD/MM/AAAA).
 */
function cotacoes_parseData(dateString) {
    // Garante que o valor de entrada é uma string antes de processar
    if (typeof dateString !== 'string' || !dateString.trim()) {
        return null;
    }

    const parts = dateString.trim().split(' ');
    
    // Verifica se a data (primeira parte) existe e tem o formato com barras
    if (!parts[0] || parts[0].split('/').length !== 3) {
        return null; // Retorna nulo se não estiver no formato esperado
    }
    
    const dataParts = parts[0].split('/'); // Divide a data por '/'
    const timeParts = parts[1] ? parts[1].split(':') : [0, 0, 0];
    
    // --- CORREÇÃO PRINCIPAL AQUI ---
    // Atribui as partes da data na ordem correta: Dia, Mês, Ano
    const day = parseInt(dataParts[0], 10);
    const month = parseInt(dataParts[1], 10) - 1; // Mês no JS é 0-indexed (0-11)
    const year = parseInt(dataParts[2], 10);
    
    const hours = parseInt(timeParts[0] || 0, 10);
    const minutes = parseInt(timeParts[1] || 0, 10);
    const seconds = parseInt(timeParts[2] || 0, 10);

    // Valida se as partes são números válidos
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
        return null;
    }
    
    // Valida se o ano tem 4 dígitos para evitar datas como '05/04/24'
    if (String(year).length < 4) {
        return null;
    }

    return new Date(year, month, day, hours, minutes, seconds);
}

// functions/modules/cotacoes.js

/**
 * Agrupa os itens de cotação da planilha na estrutura de Documento com Sub-coleção (Array de Itens).
 * Cada linha da planilha é um item, e agrupamos eles pelo 'ID da Cotação', criando um documento
 * principal para a cotação e aninhando os itens em um array 'itens'.
 * ESTA FUNÇÃO FOI ATUALIZADA PARA CRIAR A ESTRUTURA DE DADOS SOLICITADA.
 */
function cotacoes_agruparCotacoes(data) {
    if (!data || data.length < 2) {
        return [];
    }

    const headers = data[0];
    const rows = data.slice(1);
    const cotacoesAgrupadas = {};

    // Lista de todos os cabeçalhos que devem ser tratados como números.
    const camposNumericos = [
        'Preço', 'Preço por Fator', 'Valor Total', 'Economia em Cotação',
        'Estoque Mínimo', 'Fator', 'Estoque Atual', 'Quantidade Recebida',
        'Divergencia da Nota', 'Quantidade na Nota', 'Preço da Nota'
    ];

    rows.forEach(row => {
        // Objeto temporário para armazenar todos os dados da linha atual
        const itemDaLinha = {};
        headers.forEach((header, index) => {
            let value = row[index] !== undefined && row[index] !== null ? row[index] : "";

            // Limpeza e conversão de tipos de dados
            if (camposNumericos.includes(header)) {
                // Converte para número, tratando vírgula como decimal. Se falhar, vira 0.
                value = parseFloat(String(value).replace(',', '.')) || 0;
            } else if (header === 'Data Abertura') {
                const parsedDate = cotacoes_parseData(value);
                // Apenas converte para Timestamp se a data for válida
                if (parsedDate) {
                    value = admin.firestore.Timestamp.fromDate(parsedDate);
                } else {
                    value = null; // Salva como nulo se a data for inválida
                }
            }
            itemDaLinha[header] = value;
        });

        const cotacaoId = itemDaLinha['ID da Cotação'];
        if (!cotacaoId) {
            return; // Pula linhas que não têm um ID de cotação
        }

        // Se for a primeira vez que encontramos essa cotação, criamos sua estrutura principal.
        if (!cotacoesAgrupadas[cotacaoId]) {
            cotacoesAgrupadas[cotacaoId] = {
                idCotacao: cotacaoId, // Este campo será usado como ID do documento no Firestore
                "Data Abertura": itemDaLinha['Data Abertura'],
                "Status da Cotação": itemDaLinha['Status da Cotação'],
                itens: [] // O array que vai conter todos os subprodutos/itens
            };
        }

        // Criamos um objeto de item limpo, removendo os campos que já estão no nível principal do documento.
        // Isso evita a duplicação de dados dentro do array 'itens'.
        const itemParaArray = { ...itemDaLinha };
        delete itemParaArray['ID da Cotação'];
        delete itemParaArray['Data Abertura'];
        delete itemParaArray['Status da Cotação'];

        // Adicionamos o objeto do item (representando o subproduto) ao array 'itens' da cotação correta.
        cotacoesAgrupadas[cotacaoId].itens.push(itemParaArray);
    });

    return Object.values(cotacoesAgrupadas);
}

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
 * ESTA VERSÃO FOI CORRIGIDA PARA REDUZIR O TAMANHO DO LOTE DE ESCRITA (BATCH),
 * EVITANDO O ERRO DE PAYLOAD DO FIRESTORE.
 */
cotacoesRouter.post('/cotacoes/import', async (req, res) => {
    const SHEET_NAME = 'Cotacoes';
    // --- CORREÇÃO PRINCIPAL AQUI ---
    // Reduzimos o BATCH_SIZE drasticamente. Em vez de 450 cotações por lote,
    // agora enviaremos apenas 20. Isso cria pacotes de escrita menores.
    const BATCH_SIZE = 20;
    const CHUNK_ROWS = 5000;    // A leitura em blocos continua igual e eficiente.

    logger.info(`API: Iniciando importação da planilha: ${SHEET_NAME}`);

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: serviceAccountKey.client_email,
                private_key: serviceAccountKey.private_key,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const db = admin.firestore();

        // 1. Ler os cabeçalhos primeiro
        const headerResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!1:1`,
        });
        const headers = headerResponse.data.values[0];
        let allRows = [headers];

        // 2. Ler o restante da planilha em blocos (chunks)
        let startRow = 2;
        let continueReading = true;

        while (continueReading) {
            const range = `${SHEET_NAME}!A${startRow}:Z${startRow + CHUNK_ROWS - 1}`;
            logger.info(`API: Lendo bloco de dados do range: ${range}`);
            
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: range,
            });

            const chunkData = response.data.values;

            if (chunkData && chunkData.length > 0) {
                allRows.push(...chunkData);
                
                if (chunkData.length < CHUNK_ROWS) {
                    continueReading = false;
                } else {
                    startRow += CHUNK_ROWS;
                }
            } else {
                continueReading = false;
            }
        }

        if (allRows.length <= 1) {
            logger.warn('API: Nenhum dado de cotação encontrado na planilha (além do cabeçalho).');
            return res.status(404).send('Nenhum dado de cotação encontrado na planilha.');
        }

        logger.info(`API: Leitura da planilha concluída. Total de ${allRows.length -1} linhas de dados encontradas.`);
        
        // 3. Processa e agrupa todos os dados que foram lidos
        const cotacoesProcessadas = cotacoes_agruparCotacoes(allRows);
        logger.info(`API: ${cotacoesProcessadas.length} cotações agrupadas para importação.`);

        // 4. Grava em lotes no Firestore (agora com BATCH_SIZE menor)
        for (let i = 0; i < cotacoesProcessadas.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunkToCommit = cotacoesProcessadas.slice(i, i + BATCH_SIZE);
            
            logger.info(`API: Preparando lote de escrita ${Math.floor(i / BATCH_SIZE) + 1} com ${chunkToCommit.length} cotações.`);

            chunkToCommit.forEach(cotacao => {
                const docRef = db.collection(COTACOES_COLLECTION).doc(String(cotacao.idCotacao));
                batch.set(docRef, cotacao);
            });

            await batch.commit();
            logger.info(`API: Lote de ${chunkToCommit.length} cotações importado com sucesso.`);
        }

        res.status(200).send(`Importação da planilha '${SHEET_NAME}' concluída com sucesso.`);

    } catch (error) {
        logger.error('API: Erro durante a importação de cotações:', error);
        res.status(500).send(`Erro na importação: ${error.message}`);
    }
});


/**
 * Rota para obter os resumos de cotações do Firestore.
 * ESTA VERSÃO FOI CORRIGIDA PARA LER A NOVA ESTRUTURA DE DOCUMENTOS,
 * COM UM ARRAY 'itens' ANINHADO.
 */
cotacoesRouter.get('/cotacoes/resumos', async (req, res) => {
    logger.info("API: Recebida requisição para obter resumos de cotações.");
    try {
        const db = admin.firestore();
        const snapshot = await db.collection(COTACOES_COLLECTION).orderBy("Data Abertura", "desc").get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, dados: [], message: "Nenhuma cotação encontrada." });
        }

        const arrayDeResumos = snapshot.docs.map(doc => {
            const cotacao = doc.data();
            
            // Extrai as categorias únicas do array 'itens'
            const categorias = new Set();
            if (cotacao.itens && Array.isArray(cotacao.itens)) {
                cotacao.itens.forEach(item => {
                    if (item.Categoria) {
                        categorias.add(item.Categoria);
                    }
                });
            }

            // Formata a data de abertura, que agora é um Timestamp do Firestore
            let dataAberturaFormatada = "N/A";
            if (cotacao['Data Abertura'] && typeof cotacao['Data Abertura'].toDate === 'function') {
                dataAberturaFormatada = cotacao['Data Abertura'].toDate().toLocaleDateString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });
            }

            // Monta o objeto de resumo para o front-end
            return {
                ID_da_Cotacao: cotacao.idCotacao,
                Data_Abertura_Formatada: dataAberturaFormatada,
                Status_da_Cotacao: cotacao['Status da Cotação'] || "Status Desconhecido",
                Categorias_Unicas_String: Array.from(categorias).join(', ')
            };
        });

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

