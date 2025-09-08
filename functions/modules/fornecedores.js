// functions/modules/fornecedores.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { google } from "googleapis";

export const fornecedoresRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const SPREADSHEET_ID = '1CFbP6_VC4TOJXITwO-nvxu6IX1brAYJNUCaRW0VDXDY';
const SHEET_NAME = 'Fornecedores'; // Nome exato da aba na sua planilha

// --- DADOS MOCADOS (USADOS PELAS FUNÇÕES ANTIGAS) ---
let mockFornecedores = [
    { "Data de Cadastro": "01/01/2025 10:00:00", "ID": "1", "Fornecedor": "Distribuidora Alfa", "CNPJ": "11.111.111/0001-11", "Categoria": "Bebidas", "Vendedor": "Carlos", "Telefone": "(34) 99999-1111", "Email": "carlos@alfa.com", "Dias de Pedido": "Seg, Qua", "Dia de Faturamento": "Sexta", "Dias de Entrega": "3", "Condições de Pagamento": "30 DDL", "Pedido Mínimo (R$)": "500.00", "Regime Tributário": "Simples Nacional", "Contato Financeiro": "financeiro@alfa.com", "Status": "Ativo" },
    { "Data de Cadastro": "02/02/2025 11:30:00", "ID": "2", "Fornecedor": "Mercearia Beta", "CNPJ": "22.222.222/0001-22", "Categoria": "Alimentos Secos", "Vendedor": "Beatriz", "Telefone": "(34) 99999-2222", "Email": "beatriz@beta.com", "Dias de Pedido": "Ter, Qui", "Dia de Faturamento": "Sexta", "Dias de Entrega": "2", "Condições de Pagamento": "15 DDL", "Pedido Mínimo (R$)": "300.00", "Regime Tributário": "Lucro Presumido", "Contato Financeiro": "financeiro@beta.com", "Status": "Ativo" },
    { "Data de Cadastro": "03/03/2025 14:00:00", "ID": "3", "Fornecedor": "Frios Gama", "CNPJ": "33.333.333/0001-33", "Categoria": "Laticínios", "Vendedor": "Gabriel", "Telefone": "(34) 99999-3333", "Email": "gabriel@gama.com", "Dias de Pedido": "Qua", "Dia de Faturamento": "Quinta", "Dias de Entrega": "1", "Condições de Pagamento": "7 DDL", "Pedido Mínimo (R$)": "250.00", "Regime Tributário": "Simples Nacional", "Contato Financeiro": "financeiro@gama.com", "Status": "Inativo" },
];
let mockSubprodutos = [
    { ID: "101", "Data de Cadastro": "05/05/2025", SubProduto: "Refrigerante 2L", "Produto Vinculado": "Refrigerantes", Fornecedor: "Distribuidora Alfa", Categoria: "Bebidas", Tamanho: "2L", UN: "UN", Fator: "1", NCM: "22021000", CST: "0102", CFOP: "5102", Status: "Ativo", ID_SubProduto: "101" },
    { ID: "102", "Data de Cadastro": "05/05/2025", SubProduto: "Arroz Tipo 1 5kg", "Produto Vinculado": "Grãos", Fornecedor: "Mercearia Beta", Categoria: "Alimentos", Tamanho: "5kg", UN: "PCT", Fator: "1", NCM: "10063021", CST: "0102", CFOP: "5102", Status: "Ativo", ID_SubProduto: "102" },
    { ID: "103", "Data de Cadastro": "06/05/2025", SubProduto: "Suco de Laranja 1L", "Produto Vinculado": "", Fornecedor: "Distribuidora Alfa", Categoria: "Bebidas", Tamanho: "1L", UN: "UN", Fator: "1", NCM: "22029900", CST: "0102", CFOP: "5102", Status: "Ativo", ID_SubProduto: "103" },
];
let mockProdutos = [
    {id: 'P1', nome: 'Refrigerantes'},
    {id: 'P2', nome: 'Grãos'},
    {id: 'P3', nome: 'Laticínios'},
];
let proximoIdFornecedor = 4;
let proximoIdSubproduto = 104;

/**
 * Função utilitária para converter dados da planilha (array de arrays) para um array de objetos.
 */
function fornecedores_convertSheetDataToObject(data) {
    const headers = data[0];
    const rows = data.slice(1);
    return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] || ""; // Garante que campos vazios se tornem strings vazias
        });
        return obj;
    });
}

// --- ROTAS DO MÓDULO FORNECEDORES ---

/**
 * Rota para importar dados de fornecedores DIRETO DO GOOGLE SHEETS para o Firestore.
 */
fornecedoresRouter.post('/fornecedores/import', async (req, res) => {
    logger.info(`API: Recebida requisição para importar fornecedores da planilha: ${SHEET_NAME}`);
    try {
        // Autenticação com a API do Google
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // Busca os dados da planilha
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}`, // Pega a aba inteira
        });

        const data = response.data.values;
        if (!data || data.length === 0) {
            logger.warn("Nenhum dado encontrado na planilha de fornecedores.");
            return res.status(404).json({ success: false, message: "Nenhum dado encontrado na planilha." });
        }

        const fornecedores = fornecedores_convertSheetDataToObject(data);

        // Salva os dados no Firestore
        const db = admin.firestore();
        const batch = db.batch();
        
        let count = 0;
        fornecedores.forEach((fornecedor) => {
            // Usa a coluna 'ID' como identificador único do documento
            if (fornecedor.ID) {
                const docRef = db.collection('fornecedores').doc(String(fornecedor.ID));
                batch.set(docRef, fornecedor);
                count++;
            }
        });

        await batch.commit();

        logger.info(`API: ${count} fornecedores importados com sucesso.`);
        res.status(200).json({ success: true, message: `${count} fornecedores importados com sucesso!` });

    } catch (e) {
        logger.error("Erro ao importar fornecedores do Google Sheets:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para obter dados paginados de fornecedores.
 * Substitui: FornecedoresController_obterDadosCompletosFornecedores
 */
fornecedoresRouter.post('/fornecedores/list', (req, res) => {
    logger.info("API: Recebida requisição para listar fornecedores", { body: req.body });
    try {
        const { pagina = 1, itensPorPagina = 10, termoBusca = "" } = req.body;
        
        let fornecedoresFiltrados = mockFornecedores;
        if (termoBusca) {
            const termoNormalizado = termoBusca.toLowerCase().trim();
            fornecedoresFiltrados = mockFornecedores.filter(f => 
                Object.values(f).some(val => String(val).toLowerCase().includes(termoNormalizado))
            );
        }

        const totalItens = fornecedoresFiltrados.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPagina);
        const offset = (pagina - 1) * itensPorPagina;
        const fornecedoresPaginados = fornecedoresFiltrados.slice(offset, offset + itensPorPagina);

        const resposta = {
            cabecalhosParaExibicao: ["Fornecedor", "CNPJ", "Vendedor", "Telefone", "Email"],
            fornecedoresPaginados,
            totalItens,
            paginaAtual: pagina,
            totalPaginas
        };
        res.status(200).json(resposta);
    } catch (e) {
        logger.error("Erro ao listar fornecedores:", e);
        res.status(500).json({ error: true, message: e.message });
    }
});

/**
 * Rota para criar um novo fornecedor.
 * Substitui: FornecedoresController_criarNovoFornecedor
 */
fornecedoresRouter.post('/fornecedores/create', (req, res) => {
    logger.info("API: Recebida requisição para criar fornecedor", { body: req.body });
    try {
        const dadosNovoFornecedor = req.body;
        if (!dadosNovoFornecedor || !dadosNovoFornecedor["Fornecedor"]) {
            return res.status(400).json({ success: false, message: "Nome do Fornecedor é obrigatório." });
        }
        
        const novoId = String(proximoIdFornecedor++);
        const novoFornecedor = {
            "Data de Cadastro": new Date().toLocaleString('pt-BR'),
            "ID": novoId,
            ...dadosNovoFornecedor
        };
        mockFornecedores.push(novoFornecedor);
        
        res.status(201).json({ success: true, message: "Fornecedor criado com sucesso!", novoId: novoId });
    } catch (e) {
        logger.error("Erro ao criar fornecedor:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para atualizar um fornecedor existente.
 * Substitui: FornecedoresController_atualizarFornecedor
 */
fornecedoresRouter.post('/fornecedores/update', (req, res) => {
    logger.info("API: Recebida requisição para atualizar fornecedor", { body: req.body });
    try {
        const dadosParaAtualizar = req.body;
        const { ID } = dadosParaAtualizar;
        if (!ID) {
            return res.status(400).json({ success: false, message: "ID do fornecedor é obrigatório para atualização." });
        }

        const index = mockFornecedores.findIndex(f => f.ID === String(ID));
        if (index === -1) {
            return res.status(404).json({ success: false, message: `Fornecedor com ID '${ID}' não encontrado.` });
        }
        
        mockFornecedores[index] = { ...mockFornecedores[index], ...dadosParaAtualizar };
        
        res.status(200).json({ success: true, message: "Fornecedor atualizado com sucesso!" });
    } catch (e) {
        logger.error("Erro ao atualizar fornecedor:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para obter subprodutos de um fornecedor.
 * Substitui: FornecedoresCRUD_obterSubProdutosPorNomeFornecedor
 */
fornecedoresRouter.post('/fornecedores/getSubprodutos', (req, res) => {
    const { nomeFornecedor } = req.body;
    logger.info(`API: Buscando subprodutos para o fornecedor: ${nomeFornecedor}`);
    const itens = mockSubprodutos.filter(sp => sp.Fornecedor === nomeFornecedor);
    res.status(200).json(itens);
});

/**
 * Rota para obter outros fornecedores, exceto um.
 * Substitui: FornecedoresCRUD_obterListaOutrosFornecedores
 */
fornecedoresRouter.post('/fornecedores/getOthers', (req, res) => {
    const { idFornecedorExcluido } = req.body;
    logger.info(`API: Buscando outros fornecedores, exceto ID: ${idFornecedorExcluido}`);
    const outros = mockFornecedores
        .filter(f => f.ID !== String(idFornecedorExcluido))
        .map(f => ({ id: f.ID, nome: f.Fornecedor }));
    res.status(200).json(outros);
});

/**
 * Rota para processar a exclusão de um fornecedor.
 * Substitui: FornecedoresCRUD_processarExclusaoFornecedor
 */
fornecedoresRouter.post('/fornecedores/delete', (req, res) => {
    const { idFornecedor, nomeFornecedorOriginal, deletarSubprodutosVinculados, realocacoesSubprodutos } = req.body;
    logger.info(`API: Processando exclusão do fornecedor ID ${idFornecedor}`, { body: req.body });
    
    const index = mockFornecedores.findIndex(f => f.ID === String(idFornecedor));
    if (index === -1) {
        return res.status(404).json({ success: false, message: `Fornecedor com ID '${idFornecedor}' não encontrado.` });
    }
    
    mockFornecedores.splice(index, 1);
    
    // Simula a lógica de realocação/deleção de subprodutos
    if (deletarSubprodutosVinculados) {
        mockSubprodutos = mockSubprodutos.filter(sp => sp.Fornecedor !== nomeFornecedorOriginal);
    } else if (realocacoesSubprodutos && realocacoesSubprodutos.length > 0) {
        realocacoesSubprodutos.forEach(r => {
            const subIndex = mockSubprodutos.findIndex(sp => sp.ID === String(r.subProdutoId));
            if (subIndex !== -1) {
                mockSubprodutos[subIndex].Fornecedor = r.novoFornecedorNome;
            }
        });
    }

    res.status(200).json({ success: true, message: `Fornecedor '${nomeFornecedorOriginal}' excluído.` });
});


// --- ROTAS DO MÓDULO SUBPRODUTOS (DENTRO DE FORNECEDORES) ---

/**
 * Rota para obter detalhes de um subproduto por ID.
 * Substitui: SubProdutosCRUD_obterDetalhesSubProdutoPorId
 */
fornecedoresRouter.post('/subprodutos/getDetails', (req, res) => {
    const { itemId } = req.body;
    logger.info(`API: buscando detalhes do subproduto ID ${itemId}`);
    const item = mockSubprodutos.find(sp => sp.ID === String(itemId));
    if (item) {
        res.status(200).json(item);
    } else {
        res.status(404).json(null);
    }
});

/**
 * Rota para criar um novo subproduto.
 * Substitui: SubProdutosCRUD_criarNovoSubProduto_NOVO
 */
fornecedoresRouter.post('/subprodutos/create', (req, res) => {
    const dadosItem = req.body;
    logger.info('API: Criando novo subproduto', { body: dadosItem });
    const novoId = String(proximoIdSubproduto++);
    const novoSubproduto = {
        "Data de Cadastro": new Date().toLocaleDateString('pt-BR'),
        ID: novoId,
        ID_SubProduto: novoId,
        ...dadosItem
    };
    mockSubprodutos.push(novoSubproduto);
    res.status(201).json({ success: true, message: 'Item adicionado com sucesso!' });
});

/**
 * Rota para atualizar um subproduto.
 * Substitui: SubProdutosCRUD_atualizarSubProduto
 */
fornecedoresRouter.post('/subprodutos/update', (req, res) => {
    const dadosItem = req.body;
    const { ID_SubProduto_Edicao } = dadosItem;
    logger.info(`API: Atualizando subproduto ID ${ID_SubProduto_Edicao}`, { body: dadosItem });
    const index = mockSubprodutos.findIndex(sp => sp.ID === String(ID_SubProduto_Edicao));
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Item não encontrado.' });
    }
    mockSubprodutos[index] = { ...mockSubprodutos[index], ...dadosItem };
    res.status(200).json({ success: true, message: 'Item atualizado com sucesso.' });
});

/**
 * Rota para excluir um subproduto.
 * Substitui: SubProdutosCRUD_excluirSubProduto
 */
fornecedoresRouter.post('/subprodutos/delete', (req, res) => {
    const { itemId } = req.body;
    logger.info(`API: Excluindo subproduto ID ${itemId}`);
    const initialLength = mockSubprodutos.length;
    mockSubprodutos = mockSubprodutos.filter(sp => sp.ID !== String(itemId));
    if (mockSubprodutos.length < initialLength) {
        res.status(200).json({ success: true, message: 'Item excluído com sucesso.' });
    } else {
        res.status(404).json({ success: false, message: 'Item não encontrado.' });
    }
});


// --- ROTAS DO MÓDULO PRODUTOS (CHAMADAS PELA VIEW DE FORNECEDORES) ---

/**
 * Rota para obter nomes e IDs de produtos.
 * Substitui: ProdutosCRUD_obterNomesEIdsProdutos
 */
fornecedoresRouter.get('/produtos/list-names', (req, res) => {
    logger.info("API: Listando nomes de produtos.");
    res.status(200).json(mockProdutos);
});