// functions/subprodutos.js
import { Router } from "express";
import logger from "firebase-functions/logger";

export const subProdutosRouter = Router();

// --- DADOS MOCADOS (SUBSTITUTOS PARA A PLANILHA) ---
// Simula as informações das planilhas "SubProdutos", "Produtos" e "Fornecedores"
let mockSubProdutos = [
    { "Data de Cadastro": "05/05/2025 10:00:00", "ID": "101", "ID_SubProduto": "101", "SubProduto": "COCA-COLA 2L", "Produto Vinculado": "REFRIGERANTE", "Fornecedor": "Distribuidora Alfa", "Categoria": "BEBIDAS", "Tamanho": "2L", "UN": "UN", "Fator": "1", "NCM": "22021000", "CST": "0102", "CFOP": "5102", "Status": "Ativo" },
    { "Data de Cadastro": "05/05/2025 11:00:00", "ID": "102", "ID_SubProduto": "102", "SubProduto": "GUARANÁ ANTARCTICA 2L", "Produto Vinculado": "REFRIGERANTE", "Fornecedor": "Distribuidora Alfa", "Categoria": "BEBIDAS", "Tamanho": "2L", "UN": "UN", "Fator": "1", "NCM": "22021000", "CST": "0102", "CFOP": "5102", "Status": "Ativo" },
    { "Data de Cadastro": "06/05/2025 14:30:00", "ID": "103", "ID_SubProduto": "103", "SubProduto": "ARROZ TIO JOÃO 5KG", "Produto Vinculado": "ARROZ AGULHINHA T1", "Fornecedor": "Mercearia Beta", "Categoria": "CESTA BÁSICA", "Tamanho": "5KG", "UN": "PCT", "Fator": "1", "NCM": "10063021", "CST": "0102", "CFOP": "5102", "Status": "Ativo" },
    { "Data de Cadastro": "07/05/2025 09:00:00", "ID": "104", "ID_SubProduto": "104", "SubProduto": "LEITE PARMALAT 1L", "Produto Vinculado": "LEITE INTEGRAL", "Fornecedor": "Frios Gama", "Categoria": "LATICINIOS", "Tamanho": "1L", "UN": "L", "Fator": "1", "NCM": "04012010", "CST": "0102", "CFOP": "5102", "Status": "Inativo" },
];

let mockProdutos = [
    { ID: "1", Produto: "REFRIGERANTE" },
    { ID: "2", Produto: "ARROZ AGULHINHA T1" },
    { ID: "3", Produto: "LEITE INTEGRAL" },
    { ID: "4", Produto: "CAFÉ TORRADO E MOÍDO" },
];

let mockFornecedores = [
    { ID: "1", Fornecedor: "Distribuidora Alfa" },
    { ID: "2", Fornecedor: "Mercearia Beta" },
    { ID: "3", Fornecedor: "Frios Gama" },
];

let proximoIdSubProduto = 105;

// --- Funções Utilitárias ---

/**
 * Normaliza o texto para comparação: remove acentos, converte para minúsculas e remove espaços extras.
 * Substitui: SubProdutosController_normalizarTextoComparacao e SubProdutosCRUD_normalizarTextoComparacao
 * @param {string} texto O texto a ser normalizado.
 * @return {string} O texto normalizado.
 */
function subProdutos_normalizarTextoComparacao(texto) {
    if (!texto || typeof texto !== 'string') return "";
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Obtém o nome de um produto pelo seu ID a partir dos dados mocados.
 * Substitui: SubProdutosCRUD_obterNomeProdutoPorId
 * @param {string} produtoId O ID do produto.
 * @return {string|null} O nome do produto ou null se não encontrado.
 */
function subProdutos_obterNomeProdutoPorId(produtoId) {
    if (!produtoId) return null;
    const produto = mockProdutos.find(p => String(p.ID) === String(produtoId));
    return produto ? produto.Produto : null;
}

/**
 * Obtém o nome de um fornecedor pelo seu ID a partir dos dados mocados.
 * Substitui: SubProdutosCRUD_obterNomeFornecedorPorId
 * @param {string} fornecedorId O ID do fornecedor.
 * @return {string|null} O nome do fornecedor ou null se não encontrado.
 */
function subProdutos_obterNomeFornecedorPorId(fornecedorId) {
    if (!fornecedorId) return null;
    const fornecedor = mockFornecedores.find(f => String(f.ID) === String(fornecedorId));
    return fornecedor ? fornecedor.Fornecedor : null;
}


// --- ROTAS DO MÓDULO SUBPRODUTOS ---

/**
 * Rota para obter a lista de subprodutos de forma paginada e com filtro.
 * Substitui: SubProdutosController_obterListaSubProdutosPaginada
 */
subProdutosRouter.post('/subprodutos/list', (req, res) => {
    logger.info("API: Recebida requisição para listar subprodutos", { body: req.body });
    try {
        const { pagina = 1, itensPorPagina = 10, termoBusca = "" } = req.body;

        let subProdutosFiltrados = mockSubProdutos;
        if (termoBusca) {
            const termoNormalizado = subProdutos_normalizarTextoComparacao(termoBusca);
            subProdutosFiltrados = mockSubProdutos.filter(sub =>
                Object.values(sub).some(val => subProdutos_normalizarTextoComparacao(String(val)).includes(termoNormalizado))
            );
        }

        const totalItens = subProdutosFiltrados.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPagina) || 1;
        const paginaAjustada = Math.min(Math.max(1, pagina), totalPaginas);
        const offset = (paginaAjustada - 1) * itensPorPagina;
        const subProdutosPaginados = subProdutosFiltrados.slice(offset, offset + itensPorPagina);

        const resposta = {
            cabecalhosParaExibicao: ["SubProduto", "Produto Vinculado", "Fornecedor", "Categoria", "UN", "Status"],
            subProdutosPaginados: subProdutosPaginados,
            totalItens: totalItens,
            paginaAtual: paginaAjustada,
            totalPaginas: totalPaginas,
        };
        res.status(200).json(resposta);
    } catch (e) {
        logger.error("Erro ao listar subprodutos:", e);
        res.status(500).json({ error: true, message: e.message });
    }
});

/**
 * Rota para criar um novo subproduto.
 * Substitui: SubProdutosCRUD_criarNovoSubProduto
 */
subProdutosRouter.post('/subprodutos/create-standalone', (req, res) => {
    logger.info("API: Recebida requisição para criar subproduto (standalone)", { body: req.body });
    try {
        const dadosNovoSubProduto = req.body;

        // Validação de campos obrigatórios
        if (!dadosNovoSubProduto || !dadosNovoSubProduto["SubProduto"]) {
            return res.status(400).json({ success: false, message: "O campo 'SubProduto' é obrigatório." });
        }
        if (!dadosNovoSubProduto["Produto Vinculado"]) { // No formulário, "Produto Vinculado" virá como o ID
            return res.status(400).json({ success: false, message: "O campo 'Produto Vinculado' é obrigatório." });
        }
        if (!dadosNovoSubProduto["UN"]) {
            return res.status(400).json({ success: false, message: "O campo 'UN' é obrigatório." });
        }

        // Converte IDs em Nomes antes de salvar e validar
        const nomeProdutoVinculado = subProdutos_obterNomeProdutoPorId(dadosNovoSubProduto["Produto Vinculado"]);
        if (!nomeProdutoVinculado) {
            return res.status(400).json({ success: false, message: `Produto Vinculado com ID '${dadosNovoSubProduto["Produto Vinculado"]}' não encontrado.` });
        }

        let nomeFornecedor = "";
        if (dadosNovoSubProduto["Fornecedor"]) {
            nomeFornecedor = subProdutos_obterNomeFornecedorPorId(dadosNovoSubProduto["Fornecedor"]);
            if (!nomeFornecedor) {
                logger.warn(`Fornecedor com ID '${dadosNovoSubProduto["Fornecedor"]}' não encontrado. O subproduto será criado sem fornecedor.`);
            }
        }

        // Validação de duplicidade
        const nomeNovoSubProdutoNormalizado = subProdutos_normalizarTextoComparacao(dadosNovoSubProduto.SubProduto);
        const nomeProdutoVinculadoNormalizado = subProdutos_normalizarTextoComparacao(nomeProdutoVinculado);

        const subProdutoExistente = mockSubProdutos.some(sp =>
            subProdutos_normalizarTextoComparacao(sp.SubProduto) === nomeNovoSubProdutoNormalizado &&
            subProdutos_normalizarTextoComparacao(sp["Produto Vinculado"]) === nomeProdutoVinculadoNormalizado
        );

        if (subProdutoExistente) {
            return res.status(409).json({ success: false, message: `O subproduto '${dadosNovoSubProduto.SubProduto}' já está cadastrado para o produto '${nomeProdutoVinculado}'.` });
        }

        const novoId = String(proximoIdSubProduto++);
        const novoSubProduto = {
            ...dadosNovoSubProduto,
            "Data de Cadastro": new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            "ID": novoId,
            "ID_SubProduto": novoId,
            "Produto Vinculado": nomeProdutoVinculado, // Salva o nome
            "Fornecedor": nomeFornecedor || "" // Salva o nome
        };

        mockSubProdutos.push(novoSubProduto);

        res.status(201).json({ success: true, message: "Subproduto criado com sucesso!", novoId: novoId });
    } catch (e) {
        logger.error("Erro ao criar subproduto:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para atualizar um subproduto existente.
 * Substitui: SubProdutosCRUD_atualizarSubProduto
 */
subProdutosRouter.post('/subprodutos/update-standalone', (req, res) => {
    logger.info("API: Recebida requisição para atualizar subproduto (standalone)", { body: req.body });
    try {
        const dadosParaAtualizar = req.body;
        const { ID } = dadosParaAtualizar;

        if (!ID) {
            return res.status(400).json({ success: false, message: "ID do subproduto é obrigatório para atualização." });
        }

        const index = mockSubProdutos.findIndex(sp => String(sp.ID) === String(ID));
        if (index === -1) {
            return res.status(404).json({ success: false, message: `Subproduto com ID '${ID}' não encontrado.` });
        }

        // Converte IDs em Nomes antes de salvar e validar
        const nomeProdutoVinculado = subProdutos_obterNomeProdutoPorId(dadosParaAtualizar["Produto Vinculado"]);
        if (!nomeProdutoVinculado) {
            return res.status(400).json({ success: false, message: `Produto Vinculado com ID '${dadosParaAtualizar["Produto Vinculado"]}' não encontrado.` });
        }

        let nomeFornecedor = "";
        if (dadosParaAtualizar["Fornecedor"]) {
            nomeFornecedor = subProdutos_obterNomeFornecedorPorId(dadosParaAtualizar["Fornecedor"]);
            if (!nomeFornecedor) {
                logger.warn(`Fornecedor com ID '${dadosParaAtualizar["Fornecedor"]}' não encontrado. O campo Fornecedor será salvo em branco.`);
            }
        }

        // Validação de duplicidade
        const nomeSubProdutoAtualizadoNormalizado = subProdutos_normalizarTextoComparacao(dadosParaAtualizar.SubProduto);
        const nomeProdutoVinculadoNormalizado = subProdutos_normalizarTextoComparacao(nomeProdutoVinculado);

        const outroSubProdutoComMesmoNome = mockSubProdutos.find(sp =>
            String(sp.ID) !== String(ID) &&
            subProdutos_normalizarTextoComparacao(sp.SubProduto) === nomeSubProdutoAtualizadoNormalizado &&
            subProdutos_normalizarTextoComparacao(sp["Produto Vinculado"]) === nomeProdutoVinculadoNormalizado
        );

        if (outroSubProdutoComMesmoNome) {
            return res.status(409).json({ success: false, message: `O subproduto '${dadosParaAtualizar.SubProduto}' já está cadastrado para o produto '${nomeProdutoVinculado}'.` });
        }

        // Monta o objeto atualizado
        const subProdutoAtualizado = {
            ...mockSubProdutos[index], // Mantém os dados antigos
            ...dadosParaAtualizar,     // Sobrescreve com os novos dados
            "Produto Vinculado": nomeProdutoVinculado, // Garante que o nome seja salvo
            "Fornecedor": nomeFornecedor || ""       // Garante que o nome seja salvo
        };

        mockSubProdutos[index] = subProdutoAtualizado;

        res.status(200).json({ success: true, message: "Subproduto atualizado com sucesso!" });
    } catch (e) {
        logger.error("Erro ao atualizar subproduto:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para excluir um subproduto.
 * Substitui: SubProdutosCRUD_excluirSubProduto
 */
subProdutosRouter.post('/subprodutos/delete-standalone', (req, res) => {
    logger.info("API: Recebida requisição para excluir subproduto (standalone)", { body: req.body });
    try {
        const { subProdutoId } = req.body;
        if (!subProdutoId) {
            return res.status(400).json({ success: false, message: "ID do subproduto é obrigatório para exclusão." });
        }

        const initialLength = mockSubProdutos.length;
        mockSubProdutos = mockSubProdutos.filter(sp => String(sp.ID) !== String(subProdutoId));

        if (mockSubProdutos.length < initialLength) {
            res.status(200).json({ success: true, message: 'Subproduto excluído com sucesso.' });
        } else {
            res.status(404).json({ success: false, message: `Subproduto com ID '${subProdutoId}' não encontrado.` });
        }
    } catch (e) {
        logger.error("Erro ao excluir subproduto:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para cadastrar múltiplos subprodutos de uma vez.
 * Substitui: SubProdutosCRUD_cadastrarMultiplosSubProdutos
 */
subProdutosRouter.post('/subprodutos/create-multiple', (req, res) => {
    logger.info("API: Recebida requisição para cadastrar múltiplos subprodutos", { body: req.body });
    try {
        const { fornecedorGlobal, subProdutos } = req.body;

        if (!subProdutos || !Array.isArray(subProdutos) || subProdutos.length === 0) {
            return res.status(400).json({ success: false, message: "A lista 'subProdutos' é obrigatória e deve conter itens." });
        }

        let nomeFornecedorGlobal = "";
        if (fornecedorGlobal) {
            nomeFornecedorGlobal = subProdutos_obterNomeFornecedorPorId(fornecedorGlobal);
            if (!nomeFornecedorGlobal) {
                logger.warn(`Fornecedor Global com ID '${fornecedorGlobal}' não encontrado. Subprodutos serão cadastrados sem este fornecedor.`);
            }
        }

        const resultadosDetalhados = [];
        let subProdutosAdicionadosComSucesso = 0;
        const novasLinhasParaAdicionar = [];

        for (const sub of subProdutos) {
            if (!sub.SubProduto || !sub.UN || !sub.ProdutoVinculadoID) {
                resultadosDetalhados.push({ nome: sub.SubProduto || "Nome não fornecido", status: "Falha", erro: "Campos 'SubProduto', 'UN' e 'ProdutoVinculadoID' são obrigatórios." });
                continue;
            }

            const nomeProdutoVinculado = subProdutos_obterNomeProdutoPorId(sub.ProdutoVinculadoID);
            if (!nomeProdutoVinculado) {
                resultadosDetalhados.push({ nome: sub.SubProduto, status: "Falha", erro: `Produto Vinculado com ID '${sub.ProdutoVinculadoID}' não encontrado.` });
                continue;
            }

            const nomeSubProdutoNormalizado = subProdutos_normalizarTextoComparacao(sub.SubProduto);
            const nomeProdutoVinculadoNormalizado = subProdutos_normalizarTextoComparacao(nomeProdutoVinculado);

            // Valida duplicidade contra o mock existente E contra as novas linhas já processadas
            const duplicadoExistente = mockSubProdutos.some(sp => subProdutos_normalizarTextoComparacao(sp.SubProduto) === nomeSubProdutoNormalizado && subProdutos_normalizarTextoComparacao(sp["Produto Vinculado"]) === nomeProdutoVinculadoNormalizado);
            const duplicadoNoLote = novasLinhasParaAdicionar.some(nl => subProdutos_normalizarTextoComparacao(nl.SubProduto) === nomeSubProdutoNormalizado && subProdutos_normalizarTextoComparacao(nl["Produto Vinculado"]) === nomeProdutoVinculadoNormalizado);

            if (duplicadoExistente || duplicadoNoLote) {
                resultadosDetalhados.push({ nome: sub.SubProduto, status: "Falha", erro: `Já cadastrado ou duplicado no lote para o produto '${nomeProdutoVinculado}'.` });
                continue;
            }

            const novoId = String(proximoIdSubProduto++);
            const novoSubProduto = {
                ...sub,
                "Data de Cadastro": new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                "ID": novoId,
                "ID_SubProduto": novoId,
                "Produto Vinculado": nomeProdutoVinculado,
                "Fornecedor": nomeFornecedorGlobal || "",
            };
            delete novoSubProduto.ProdutoVinculadoID; // Remove a chave temporária

            novasLinhasParaAdicionar.push(novoSubProduto);
            resultadosDetalhados.push({ nome: sub.SubProduto, status: "Sucesso", id: novoId });
            subProdutosAdicionadosComSucesso++;
        }

        // Adiciona os novos subprodutos ao mock principal
        mockSubProdutos.push(...novasLinhasParaAdicionar);

        let mensagemFinal = `${subProdutosAdicionadosComSucesso} de ${subProdutos.length} subprodutos foram processados com sucesso.`;
        if (subProdutosAdicionadosComSucesso === 0 && subProdutos.length > 0) {
            mensagemFinal = "Nenhum subproduto pôde ser cadastrado. Verifique os erros.";
        }

        res.status(200).json({ success: true, message: mensagemFinal, detalhes: resultadosDetalhados });

    } catch (e) {
        logger.error("Erro ao cadastrar múltiplos subprodutos:", e);
        res.status(500).json({ success: false, message: e.message, detalhes: [] });
    }
});


/**
 * Rota para obter a lista de todos os produtos para dropdowns.
 * Substitui: SubProdutosController_obterTodosProdutosParaDropdown
 */
subProdutosRouter.get('/subprodutos/list-produtos', (req, res) => {
    logger.info("API: Buscando lista de todos os produtos para dropdown.");
    try {
        const produtosOrdenados = [...mockProdutos].sort((a, b) => a.Produto.localeCompare(b.Produto));
        res.status(200).json(produtosOrdenados);
    } catch (e) {
        logger.error("Erro ao listar produtos para dropdown:", e);
        res.status(500).json([]);
    }
});

/**
 * Rota para obter a lista de todos os fornecedores para dropdowns.
 * Substitui: SubProdutosController_obterTodosFornecedoresParaDropdown
 */
subProdutosRouter.get('/subprodutos/list-fornecedores', (req, res) => {
    logger.info("API: Buscando lista de todos os fornecedores para dropdown.");
    try {
        const fornecedoresOrdenados = [...mockFornecedores].sort((a, b) => a.Fornecedor.localeCompare(b.Fornecedor));
        res.status(200).json(fornecedoresOrdenados);
    } catch (e) {
        logger.error("Erro ao listar fornecedores para dropdown:", e);
        res.status(500).json([]);
    }
});