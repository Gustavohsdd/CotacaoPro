// functions/modules/produtos.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { google } from "googleapis";

export const produtosRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const SPREADSHEET_ID = '1CFbP6_VC4TOJXITwO-nvxu6IX1brAYJNUCaRW0VDXDY';
const SHEET_NAME = 'Produtos'; // Nome exato da aba na sua planilha

// --- DADOS MOCADOS (USADOS PELAS FUNÇÕES ANTIGAS) ---
let mockProdutos = [
    { "Data de Cadastro": "2025-01-10 10:00:00", "ID": "1", "Produto": "REFRIGERANTE", "Tamanho": "2L", "UN": "UN", "Categoria": "BEBIDAS", "ABC": "A", "Estoque Minimo": "12", "Status": "Ativo" },
    { "Data de Cadastro": "2025-01-11 11:00:00", "ID": "2", "Produto": "ARROZ AGULHINHA T1", "Tamanho": "5KG", "UN": "PCT", "Categoria": "CESTA BÁSICA", "ABC": "A", "Estoque Minimo": "50", "Status": "Ativo" },
    { "Data de Cadastro": "2025-01-12 12:00:00", "ID": "3", "Produto": "LEITE INTEGRAL", "Tamanho": "1L", "UN": "L", "Categoria": "LATICINIOS", "ABC": "B", "Estoque Minimo": "24", "Status": "Inativo" },
    { "Data de Cadastro": "2025-01-13 13:00:00", "ID": "4", "Produto": "CAFÉ TORRADO E MOÍDO", "Tamanho": "500G", "UN": "PCT", "Categoria": "CESTA BÁSICA", "ABC": "A", "Estoque Minimo": "20", "Status": "Ativo" },
];
let mockSubProdutos = [
    { "ID": "101", "SubProduto": "COCA-COLA 2L", "Produto Vinculado": "REFRIGERANTE", "Fornecedor": "Distribuidora Alfa", "Categoria": "BEBIDAS", "Tamanho": "2L", "UN": "UN", "Fator": "1", "NCM": "22021000", "CST": "0102", "CFOP": "5102", "Status": "Ativo", "ID_SubProduto": "101" },
    { "ID": "102", "SubProduto": "GUARANÁ ANTARCTICA 2L", "Produto Vinculado": "REFRIGERANTE", "Fornecedor": "Distribuidora Alfa", "Categoria": "BEBIDAS", "Tamanho": "2L", "UN": "UN", "Fator": "1", "NCM": "22021000", "CST": "0102", "CFOP": "5102", "Status": "Ativo", "ID_SubProduto": "102" },
    { "ID": "103", "SubProduto": "ARROZ TIO JOÃO 5KG", "Produto Vinculado": "ARROZ AGULHINHA T1", "Fornecedor": "Mercearia Beta", "Categoria": "CESTA BÁSICA", "Tamanho": "5KG", "UN": "PCT", "Fator": "1", "NCM": "10063021", "CST": "0102", "CFOP": "5102", "Status": "Ativo", "ID_SubProduto": "103" },
];
let mockFornecedores = [
    { "ID": "1", "Fornecedor": "Distribuidora Alfa" },
    { "ID": "2", "Fornecedor": "Mercearia Beta" },
    { "ID": "3", "Fornecedor": "Frios Gama" },
];
let proximoIdProduto = 5;
let proximoIdSubProduto = 104;

// --- Funções Utilitárias ---

/**
 * Normaliza o texto para comparação: remove acentos, converte para minúsculas e remove espaços extras.
 */
function produtos_normalizarTextoComparacao(texto) {
  if (!texto || typeof texto !== 'string') return "";
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Função utilitária para converter dados da planilha (array de arrays) para um array de objetos.
 */
function produtos_convertSheetDataToObject(data) {
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
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}`,
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
                const docRef = db.collection('produtos').doc(String(produto.ID));
                batch.set(docRef, produto);
                count++;
            }
        });

        await batch.commit();

        logger.info(`API: ${count} produtos importados com sucesso.`);
        res.status(200).json({ success: true, message: `${count} produtos importados com sucesso!` });

    } catch (e) {
        logger.error("Erro ao importar produtos do Google Sheets:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para obter a lista de produtos de forma paginada e com filtro.
 */
produtosRouter.post('/produtos/list', (req, res) => {
    logger.info("API: Recebida requisição para listar produtos", { body: req.body });
    try {
        const { pagina = 1, itensPorPagina = 10, termoBusca = "" } = req.body;

        let produtosFiltrados = mockProdutos;
        if (termoBusca) {
            const termoNormalizado = produtos_normalizarTextoComparacao(termoBusca);
            produtosFiltrados = mockProdutos.filter(produto =>
                Object.values(produto).some(val => produtos_normalizarTextoComparacao(String(val)).includes(termoNormalizado))
            );
        }

        const totalItens = produtosFiltrados.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPagina) || 1;
        const paginaAjustada = Math.min(Math.max(1, pagina), totalPaginas);
        const offset = (paginaAjustada - 1) * itensPorPagina;
        const produtosPaginados = produtosFiltrados.slice(offset, offset + itensPorPagina);

        const resposta = {
            cabecalhosParaExibicao: ["Produto", "Tamanho", "UN", "Estoque Minimo", "Status"],
            produtosPaginados: produtosPaginados,
            totalItens: totalItens,
            paginaAtual: paginaAjustada,
            totalPaginas: totalPaginas,
        };
        res.status(200).json(resposta);
    } catch (e) {
        logger.error("Erro ao listar produtos:", e);
        res.status(500).json({ error: true, message: e.message });
    }
});

/**
 * Rota para criar um novo produto.
 */
produtosRouter.post('/produtos/create', (req, res) => {
    logger.info("API: Recebida requisição para criar produto", { body: req.body });
    try {
        const dadosNovoProduto = req.body;
        if (!dadosNovoProduto || !dadosNovoProduto["Produto"]) {
            return res.status(400).json({ error: true, success: false, message: "O campo 'Produto' é obrigatório." });
        }

        const nomeNovoProdutoNormalizado = produtos_normalizarTextoComparacao(dadosNovoProduto["Produto"]);
        const produtoExistente = mockProdutos.some(p => produtos_normalizarTextoComparacao(p.Produto) === nomeNovoProdutoNormalizado);

        if (produtoExistente) {
            return res.status(409).json({ error: true, success: false, message: `O produto '${dadosNovoProduto["Produto"]}' já está cadastrado.` });
        }

        const novoId = String(proximoIdProduto++);
        
        delete dadosNovoProduto.ID;

        const novoProduto = {
            "Data de Cadastro": new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            "ID": novoId,
            ...dadosNovoProduto
        };
        mockProdutos.push(novoProduto);

        res.status(201).json({ success: true, message: "Produto criado com sucesso!", novoId: novoId });
    } catch (e) {
        logger.error("Erro ao criar produto:", e);
        res.status(500).json({ error: true, success: false, message: e.message });
    }
});

/**
 * Rota para atualizar um produto existente.
 */
produtosRouter.post('/produtos/update', (req, res) => {
    logger.info("API: Recebida requisição para atualizar produto", { body: req.body });
    try {
        const dadosProdutoAtualizar = req.body;
        const { ID } = dadosProdutoAtualizar;
        if (!ID) {
            return res.status(400).json({ error: true, success: false, message: "ID do produto é obrigatório para atualização." });
        }

        const index = mockProdutos.findIndex(p => p.ID === String(ID));
        if (index === -1) {
            return res.status(404).json({ error: true, success: false, message: `Produto com ID '${ID}' não encontrado.` });
        }

        const nomeProdutoAntigo = mockProdutos[index].Produto;
        const nomeNovoProduto = dadosProdutoAtualizar.Produto;

        if (nomeNovoProduto && produtos_normalizarTextoComparacao(nomeProdutoAntigo) !== produtos_normalizarTextoComparacao(nomeNovoProduto)) {
            const outroProdutoComMesmoNome = mockProdutos.find(p => p.ID !== String(ID) && produtos_normalizarTextoComparacao(p.Produto) === produtos_normalizarTextoComparacao(nomeNovoProduto));
            if (outroProdutoComMesmoNome) {
                return res.status(409).json({ error: true, success: false, message: `O nome de produto '${nomeNovoProduto}' já está cadastrado para outro ID.` });
            }
        }

        mockProdutos[index] = { ...mockProdutos[index], ...dadosProdutoAtualizar };
        
        if (nomeNovoProduto && nomeProdutoAntigo !== nomeNovoProduto) {
            mockSubProdutos.forEach(sub => {
                if (sub["Produto Vinculado"] === nomeProdutoAntigo) {
                    sub["Produto Vinculado"] = nomeNovoProduto;
                }
            });
        }

        res.status(200).json({ success: true, message: "Produto atualizado com sucesso!" });
    } catch (e) {
        logger.error("Erro ao atualizar produto:", e);
        res.status(500).json({ error: true, success: false, message: e.message });
    }
});

/**
 * Rota para obter subprodutos vinculados a um produto.
 */
produtosRouter.post('/produtos/getSubprodutos', (req, res) => {
    const { nomeProduto } = req.body;
    logger.info(`API: Buscando subprodutos para o produto: ${nomeProduto}`);
    if (!nomeProduto) {
        return res.status(400).json([]);
    }
    const nomeProdutoNormalizado = produtos_normalizarTextoComparacao(nomeProduto);
    const itens = mockSubProdutos.filter(sp => produtos_normalizarTextoComparacao(sp["Produto Vinculado"]) === nomeProdutoNormalizado);
    res.status(200).json(itens);
});

/**
 * Rota para obter outros produtos, exceto o que está sendo excluído.
 */
produtosRouter.post('/produtos/getOthers', (req, res) => {
    const { idProdutoExcluido } = req.body;
    logger.info(`API: Buscando outros produtos, exceto ID: ${idProdutoExcluido}`);
    const outros = mockProdutos
        .filter(p => p.ID !== String(idProdutoExcluido))
        .map(p => ({ id: p.ID, nome: p.Produto }));
    res.status(200).json(outros);
});

/**
 * Rota para obter todos os fornecedores (usado no modal de subprodutos).
 */
produtosRouter.get('/produtos/getAllFornecedores', (req, res) => {
    logger.info(`API: Buscando lista de todos os fornecedores.`);
    const fornecedoresSimples = mockFornecedores.map(f => ({ id: f.ID, nome: f.Fornecedor }));
    res.status(200).json(fornecedoresSimples);
});

/**
 * Rota para processar a exclusão de um produto.
 */
produtosRouter.post('/produtos/delete', (req, res) => {
    const { idProduto, nomeProdutoOriginal, deletarSubprodutosVinculados, realocacoesSubprodutos } = req.body;
    logger.info(`API: Processando exclusão do produto ID ${idProduto}`, { body: req.body });

    const index = mockProdutos.findIndex(p => p.ID === String(idProduto));
    if (index === -1) {
        return res.status(404).json({ error: true, success: false, message: `Produto com ID '${idProduto}' não encontrado.` });
    }

    const nomeDoProdutoExcluido = mockProdutos[index].Produto;
    mockProdutos.splice(index, 1);
    
    let mensagemFinal = `Produto '${nomeDoProdutoExcluido}' excluído.`;
    let subProdutosAfetadosCount = 0;

    if (deletarSubprodutosVinculados) {
        const originalLength = mockSubProdutos.length;
        mockSubProdutos = mockSubProdutos.filter(sp => sp["Produto Vinculado"] !== nomeDoProdutoExcluido);
        subProdutosAfetadosCount = originalLength - mockSubProdutos.length;
        if (subProdutosAfetadosCount > 0) {
            mensagemFinal += ` ${subProdutosAfetadosCount} subprodutos vinculados foram excluídos.`;
        }
    } else if (realocacoesSubprodutos && realocacoesSubprodutos.length > 0) {
        realocacoesSubprodutos.forEach(r => {
            const subIndex = mockSubProdutos.findIndex(sp => sp.ID_SubProduto === String(r.subProdutoId));
            if (subIndex !== -1) {
                mockSubProdutos[subIndex]["Produto Vinculado"] = r.novoProdutoVinculadoNome;
                subProdutosAfetadosCount++;
            }
        });
        if (subProdutosAfetadosCount > 0) {
            mensagemFinal += ` ${subProdutosAfetadosCount} subprodutos realocados.`;
        }
    }

    res.status(200).json({ success: true, message: mensagemFinal });
});


// --- ROTAS PARA SUBPRODUTOS (VINCULADOS A PRODUTOS) ---

/**
 * Rota para criar um novo subproduto vinculado a um produto.
 */
produtosRouter.post('/subprodutos/createLinked', (req, res) => {
    logger.info('API: Criando novo subproduto vinculado', { body: req.body });
    try {
        const dadosSubProduto = req.body;
        if (!dadosSubProduto.SubProduto || !dadosSubProduto["Produto Vinculado"]) {
            return res.status(400).json({ success: false, message: "Nome do Subproduto e Produto Vinculado são obrigatórios." });
        }

        const novoId = String(proximoIdSubProduto++);
        const novoSubproduto = {
            "Data de Cadastro": new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            "ID": novoId,
            "ID_SubProduto": novoId,
            ...dadosSubProduto
        };
        mockSubProdutos.push(novoSubproduto);
        res.status(201).json({ success: true, message: 'Subproduto vinculado adicionado com sucesso!', novoId: novoId });

    } catch(e) {
        logger.error("Erro ao criar subproduto vinculado:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para atualizar um subproduto vinculado.
 */
produtosRouter.post('/subprodutos/updateLinked', (req, res) => {
    const dadosSubProdutoAtualizar = req.body;
    const { ID_SubProduto_Edicao } = dadosSubProdutoAtualizar;
    logger.info(`API: Atualizando subproduto vinculado ID ${ID_SubProduto_Edicao}`, { body: dadosSubProdutoAtualizar });
    
    if (!ID_SubProduto_Edicao) {
        return res.status(400).json({ success: false, message: "ID do Subproduto é obrigatório para atualização." });
    }

    const index = mockSubProdutos.findIndex(sp => sp.ID_SubProduto === String(ID_SubProduto_Edicao));
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Subproduto não encontrado.' });
    }

    const dadosPreservados = {
        "ID": mockSubProdutos[index].ID,
        "ID_SubProduto": mockSubProdutos[index].ID_SubProduto,
        "Data de Cadastro": mockSubProdutos[index]["Data de Cadastro"],
        "Produto Vinculado": mockSubProdutos[index]["Produto Vinculado"]
    };
    
    mockSubProdutos[index] = { ...mockSubProdutos[index], ...dadosSubProdutoAtualizar, ...dadosPreservados };
    res.status(200).json({ success: true, message: 'Subproduto atualizado com sucesso.' });
});

/**
 * Rota para obter detalhes de um subproduto.
 */
produtosRouter.post('/subprodutos/details', (req, res) => {
    const { subProdutoId } = req.body;
    logger.info(`API: buscando detalhes do subproduto ID ${subProdutoId}`);
    const item = mockSubProdutos.find(sp => sp.ID_SubProduto === String(subProdutoId));
    if (item) {
        res.status(200).json(item);
    } else {
        res.status(404).json({ error: true, message: 'Subproduto não encontrado.' });
    }
});

/**
 * Rota para excluir um subproduto.
 */
produtosRouter.post('/subprodutos/deleteSimple', (req, res) => {
    const { subProdutoId } = req.body;
    logger.info(`API: Excluindo subproduto ID ${subProdutoId}`);
    const initialLength = mockSubProdutos.length;
    mockSubProdutos = mockSubProdutos.filter(sp => sp.ID_SubProduto !== String(subProdutoId));
    if (mockSubProdutos.length < initialLength) {
        res.status(200).json({ success: true, message: 'Subproduto excluído com sucesso.' });
    } else {
        res.status(404).json({ success: false, message: 'Subproduto não encontrado.' });
    }
});