// functions/modules/cotacaoindividual.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";

export const cotacaoindividualRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const COTACOES_COLLECTION = 'cotacoes';
const PRODUTOS_COLLECTION = 'produtos';
const SUBPRODUTOS_COLLECTION = 'subprodutos';

//####################################################################################################
// MÓDULO: COTACAO INDIVIDUAL (SERVER-SIDE CRUD)
// Funções CRUD para os detalhes de uma cotação individual e operações relacionadas.
//####################################################################################################

/**
 * Normaliza números em formato string (pt-BR e en-US) para o tipo number.
 * Aceita: "1.234,56", "1234.56", "2,5", etc.
 * Retorna NaN para valores inválidos.
 */
function cotacaoindividual_parseNumeroPtBr(valor) {
    if (valor === null || valor === undefined) return NaN;
    if (typeof valor === 'number') return Number(valor);

    const s = String(valor).trim();
    if (!s) return NaN;

    const normalizado = s
        .replace(/\s+/g, '')
        .replace(/\.(?=\d{3}(?:,|$))/g, '') // Remove o ponto de milhar
        .replace(',', '.'); // Troca a vírgula decimal por ponto

    const n = Number(normalizado);
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Cria um mapa de Produto -> Média das 3 últimas compras a partir da coleção "cotacoes".
 * Itera sobre as cotações mais recentes para otimizar a busca.
 * @returns {Promise<object>} Um mapa onde a chave é o nome do produto e o valor é a demanda média.
 */
async function cotacaoindividual_criarMapaDemandaMediaProdutos() {
    logger.info("cotacaoindividual_criarMapaDemandaMediaProdutos: Iniciando criação do mapa de demanda média.");
    const mapaDemandas = {};
    const valoresComprasPorProduto = {};
    const db = admin.firestore();

    try {
        const cotacoesSnapshot = await db.collection(COTACOES_COLLECTION)
            .orderBy("Data Abertura", "desc")
            .get();

        if (cotacoesSnapshot.empty) {
            logger.warn(`cotacaoindividual_criarMapaDemandaMediaProdutos: Coleção "${COTACOES_COLLECTION}" vazia.`);
            return mapaDemandas;
        }

        for (const doc of cotacoesSnapshot.docs) {
            const cotacao = doc.data();
            if (cotacao.itens && Array.isArray(cotacao.itens)) {
                for (const item of cotacao.itens) {
                    const nomeProduto = item.Produto ? String(item.Produto).trim() : null;
                    if (nomeProduto) {
                        if (!valoresComprasPorProduto[nomeProduto] || valoresComprasPorProduto[nomeProduto].length < 3) {
                            const quantidade = cotacaoindividual_parseNumeroPtBr(item.Comprar);
                            if (Number.isFinite(quantidade) && quantidade > 0) {
                                if (!valoresComprasPorProduto[nomeProduto]) {
                                    valoresComprasPorProduto[nomeProduto] = [];
                                }
                                valoresComprasPorProduto[nomeProduto].push(quantidade);
                            }
                        }
                    }
                }
            }
        }

        for (const produto in valoresComprasPorProduto) {
            const compras = valoresComprasPorProduto[produto];
            if (compras.length > 0) {
                const soma = compras.reduce((acc, val) => acc + val, 0);
                mapaDemandas[produto] = soma / compras.length;
            }
        }

        logger.info(`cotacaoindividual_criarMapaDemandaMediaProdutos: Mapa de demanda média criado com ${Object.keys(mapaDemandas).length} entradas.`);
    } catch (error) {
        logger.error("cotacaoindividual_criarMapaDemandaMediaProdutos: Erro ao criar mapa de demanda.", error);
    }
    return mapaDemandas;
}

/**
 * Cria um mapa de Produto -> Estoque Mínimo a partir da coleção de Produtos.
 * @return {Promise<object>} Um mapa onde a chave é o nome do produto e o valor é o estoque mínimo.
 */
async function cotacaoindividual_criarMapaEstoqueMinimoProdutos() {
    logger.info("cotacaoindividual_criarMapaEstoqueMinimoProdutos: Iniciando criação do mapa de estoque mínimo.");
    const mapaEstoque = {};
    const db = admin.firestore();
    try {
        const produtosSnapshot = await db.collection(PRODUTOS_COLLECTION).get();
        if (produtosSnapshot.empty) {
            logger.warn(`cotacaoindividual_criarMapaEstoqueMinimoProdutos: Coleção "${PRODUTOS_COLLECTION}" vazia.`);
            return mapaEstoque;
        }

        produtosSnapshot.forEach(doc => {
            const produtoData = doc.data();
            const nomeProduto = produtoData.Produto ? String(produtoData.Produto).trim() : null;
            if (nomeProduto) {
                const estoqueMinimo = produtoData["Estoque Minimo"] !== undefined ? produtoData["Estoque Minimo"] : null;
                mapaEstoque[nomeProduto] = estoqueMinimo;
            }
        });

        logger.info(`cotacaoindividual_criarMapaEstoqueMinimoProdutos: Mapa de estoque mínimo criado com ${Object.keys(mapaEstoque).length} entradas.`);
    } catch (error) {
        logger.error("cotacaoindividual_criarMapaEstoqueMinimoProdutos: Erro ao criar mapa de estoque mínimo.", error);
    }
    return mapaEstoque;
}


/**
 * Busca todos os itens de uma cotação específica e enriquece com dados de demanda e estoque.
 * @param {string} idCotacaoAlvo O ID da cotação a ser buscada.
 * @return {Promise<Array<object>|null>} Um array de objetos (itens), ou null em caso de erro.
 */
async function cotacaoindividual_buscarProdutosPorIdCotacao(idCotacaoAlvo) {
    logger.info(`cotacaoindividual_buscarProdutosPorIdCotacao: Buscando produtos para ID '${idCotacaoAlvo}'.`);
    
    const [mapaEstoqueMinimo, mapaDemandaMedia] = await Promise.all([
        cotacaoindividual_criarMapaEstoqueMinimoProdutos(),
        cotacaoindividual_criarMapaDemandaMediaProdutos()
    ]);

    const db = admin.firestore();
    try {
        const docRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacaoAlvo));
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            logger.warn(`Cotação com ID '${idCotacaoAlvo}' não encontrada.`);
            return [];
        }

        const cotacao = docSnap.data();
        const itens = cotacao.itens || [];

        const itensEnriquecidos = itens.map(item => {
            const nomeProdutoPrincipal = item.Produto ? String(item.Produto).trim() : null;
            let estoqueMinimo = null;
            let demandaMedia = null;

            if (nomeProdutoPrincipal) {
                estoqueMinimo = mapaEstoqueMinimo.hasOwnProperty(nomeProdutoPrincipal)
                    ? mapaEstoqueMinimo[nomeProdutoPrincipal]
                    : null;
                demandaMedia = mapaDemandaMedia.hasOwnProperty(nomeProdutoPrincipal)
                    ? mapaDemandaMedia[nomeProdutoPrincipal]
                    : null;
            }

            return {
                ...item,
                EstoqueMinimoProdutoPrincipal: estoqueMinimo,
                DemandaMediaProdutoPrincipal: demandaMedia,
                _subProdutoOriginalPersistido: item.SubProduto || null
            };
        });

        logger.info(`cotacaoindividual_buscarProdutosPorIdCotacao: ${itensEnriquecidos.length} produtos encontrados e enriquecidos para ID '${idCotacaoAlvo}'.`);
        return itensEnriquecidos;

    } catch (e) {
        logger.error(`ERRO em cotacaoindividual_buscarProdutosPorIdCotacao para ID "${idCotacaoAlvo}":`, e);
        return null;
    }
}


//####################################################################################################
// MÓDULO: COTACAO INDIVIDUAL (SERVER-SIDE CONTROLLER)
// Transforma as funções do antigo Controller em rotas da API Express.
//####################################################################################################

/**
 * Rota para obter os detalhes de uma cotação específica.
 */
cotacaoindividualRouter.post('/cotacaoindividual/detalhes', async (req, res) => {
    const { idCotacao } = req.body;
    logger.info(`API: Recebida requisição para obter detalhes da cotação ID '${idCotacao}'.`);
    
    try {
        if (!idCotacao) {
            return res.status(400).json({ success: false, message: "ID da Cotação não fornecido." });
        }
        
        const produtosDaCotacao = await cotacaoindividual_buscarProdutosPorIdCotacao(idCotacao);

        if (produtosDaCotacao === null) {
            return res.status(500).json({ success: false, message: `Falha ao buscar produtos para cotação ID ${idCotacao}.` });
        }
        
        res.status(200).json({
            success: true,
            dados: produtosDaCotacao,
            cabecalhos: ["SubProduto", "Fornecedor", "Tamanho", "UN", "Fator", "Preço", "Preço por Fator", "Comprar", "Valor Total", "Economia em Cotação", "Empresa Faturada", "Condição de Pagamento"], // Enviando cabeçalhos para consistência
            message: `Dados da cotação ${idCotacao} carregados com sucesso.`
        });
    } catch (error) {
        logger.error(`ERRO na rota /cotacaoindividual/detalhes para ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: "Erro no servidor ao processar detalhes da cotação." });
    }
});


/**
 * Rota para salvar a alteração de uma única célula em um item da cotação.
 */
cotacaoindividualRouter.post('/cotacaoindividual/salvar-celula', async (req, res) => {
    const { idCotacao, identificadoresLinha, colunaAlterada, novoValor } = req.body;
    logger.info(`API: Recebida requisição para salvar célula:`, { idCotacao, identificadoresLinha, colunaAlterada, novoValor });

    try {
        if (!idCotacao || !identificadoresLinha || !colunaAlterada) {
            return res.status(400).json({ success: false, message: "Dados insuficientes para salvar a alteração." });
        }

        const db = admin.firestore();
        const docRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));
        
        await db.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new Error("Cotação não encontrada.");
            }

            const cotacao = docSnap.data();
            const itens = cotacao.itens || [];
            
            const itemIndex = itens.findIndex(item =>
                item.Produto === identificadoresLinha.Produto &&
                item.SubProduto === identificadoresLinha.SubProdutoChave &&
                item.Fornecedor === identificadoresLinha.Fornecedor
            );

            if (itemIndex === -1) {
                throw new Error("Item específico não encontrado na cotação para atualizar.");
            }

            const itemAtualizado = { ...itens[itemIndex] };
            itemAtualizado[colunaAlterada] = novoValor;
            
            const colunasTriggerCalculo = ['Preço', 'Comprar', 'Fator'];
            let valoresCalculados = {};

            if (colunasTriggerCalculo.includes(colunaAlterada) || (colunaAlterada === "SubProduto" && identificadoresLinha.SubProdutoChave !== novoValor)) {
                const preco   = cotacaoindividual_parseNumeroPtBr(itemAtualizado['Preço'])   || 0;
                const comprar = cotacaoindividual_parseNumeroPtBr(itemAtualizado['Comprar']) || 0;
                const fator   = cotacaoindividual_parseNumeroPtBr(itemAtualizado['Fator'])   || 0;

                itemAtualizado['Valor Total'] = preco * comprar;
                itemAtualizado['Preço por Fator'] = (fator !== 0) ? (preco / fator) : 0;
                
                valoresCalculados = {
                    valorTotal: itemAtualizado['Valor Total'],
                    precoPorFator: itemAtualizado['Preço por Fator']
                };
            }
            
            itens[itemIndex] = itemAtualizado;
            transaction.update(docRef, { itens: itens });

            res.locals.valoresCalculados = valoresCalculados;
            if (colunaAlterada === 'SubProduto') {
                res.locals.novoSubProdutoNomeSeAlterado = novoValor;
            }
        });
        
        res.status(200).json({ 
            success: true, 
            message: `Coluna '${colunaAlterada}' atualizada.`,
            valoresCalculados: res.locals.valoresCalculados,
            novoSubProdutoNomeSeAlterado: res.locals.novoSubProdutoNomeSeAlterado
        });

    } catch (error) {
        logger.error(`ERRO na rota /cotacaoindividual/salvar-celula:`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});


/**
 * Rota para salvar um conjunto de alterações de um item (vindo do modal de detalhes).
 */
cotacaoindividualRouter.post('/cotacaoindividual/salvar-detalhes-item', async (req, res) => {
    const { idCotacao, identificadoresLinha, alteracoes } = req.body;
    logger.info(`API: Recebida requisição para salvar detalhes do item:`, { idCotacao, identificadoresLinha, alteracoes });

    try {
        if (!idCotacao || !identificadoresLinha || !alteracoes || Object.keys(alteracoes).length === 0) {
            return res.status(400).json({ success: false, message: "Dados insuficientes para salvar." });
        }

        const db = admin.firestore();
        const docRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));
        
        await db.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new Error("Cotação não encontrada.");
            }

            const cotacao = docSnap.data();
            const itens = cotacao.itens || [];
            
            const itemIndex = itens.findIndex(item =>
                item.Produto === identificadoresLinha.Produto &&
                item.SubProduto === identificadoresLinha.SubProdutoChave &&
                item.Fornecedor === identificadoresLinha.Fornecedor
            );

            if (itemIndex === -1) {
                throw new Error("Item específico não encontrado na cotação para atualizar.");
            }

            const itemAtualizado = { ...itens[itemIndex], ...alteracoes };
            itens[itemIndex] = itemAtualizado;

            transaction.update(docRef, { itens: itens });
        });

        res.status(200).json({
            success: true,
            message: "Detalhes do item atualizados com sucesso!",
            novoSubProdutoNomeSeAlterado: alteracoes.SubProduto
        });

    } catch (error) {
        logger.error(`ERRO na rota /cotacaoindividual/salvar-detalhes-item:`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * Rota para acrescentar novos itens a uma cotação existente.
 */
cotacaoindividualRouter.post('/cotacaoindividual/acrescentar-itens', async (req, res) => {
    const { idCotacao, opcoesCriacao } = req.body;
    logger.info(`API: Recebida requisição para acrescentar itens à cotação ID '${idCotacao}'.`, { opcoesCriacao });

    if (!idCotacao || !opcoesCriacao || !opcoesCriacao.tipo || !opcoesCriacao.selecoes) {
        return res.status(400).json({ success: false, message: "Dados insuficientes para acrescentar itens." });
    }

    const db = admin.firestore();
    const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));

    try {
        const numItens = await db.runTransaction(async (transaction) => {
            const cotacaoDoc = await transaction.get(cotacaoRef);
            if (!cotacaoDoc.exists) {
                throw new Error("Cotação existente não foi encontrada.");
            }

            const [todosSubProdutosSnap, todosProdutosSnap] = await Promise.all([
                db.collection(SUBPRODUTOS_COLLECTION).get(),
                db.collection(PRODUTOS_COLLECTION).get()
            ]);

            const todosSubProdutos = todosSubProdutosSnap.docs.map(doc => doc.data());
            const todosProdutos = todosProdutosSnap.docs.map(doc => doc.data());
            
            const produtosMap = todosProdutos.reduce((map, prod) => {
                if (prod.Produto) map[prod.Produto] = prod;
                return map;
            }, {});

            let subProdutosFiltrados = [];
            const { tipo, selecoes } = opcoesCriacao;
            const selecoesLowerCase = selecoes.map(s => String(s).toLowerCase());

            if (tipo === 'categoria') {
                const nomesProdutos = new Set(todosProdutos.filter(p => p.Categoria && selecoesLowerCase.includes(String(p.Categoria).toLowerCase())).map(p => String(p.Produto).toLowerCase()));
                subProdutosFiltrados = todosSubProdutos.filter(sp => nomesProdutos.has(String(sp["Produto Vinculado"]).toLowerCase()));
            } else if (tipo === 'fornecedor') {
                subProdutosFiltrados = todosSubProdutos.filter(sp => sp.Fornecedor && selecoesLowerCase.includes(String(sp.Fornecedor).toLowerCase()));
            } else if (tipo === 'curvaABC') {
                const nomesProdutos = new Set(todosProdutos.filter(p => p.ABC && selecoesLowerCase.includes(String(p.ABC).toLowerCase())).map(p => String(p.Produto).toLowerCase()));
                subProdutosFiltrados = todosSubProdutos.filter(sp => nomesProdutos.has(String(sp["Produto Vinculado"]).toLowerCase()));
            } else if (tipo === 'produtoEspecifico') {
                subProdutosFiltrados = todosSubProdutos.filter(sp => sp["Produto Vinculado"] && selecoesLowerCase.includes(String(sp["Produto Vinculado"]).toLowerCase()));
            }

            if (subProdutosFiltrados.length === 0) {
                return 0; 
            }
            
            const novosItens = subProdutosFiltrados.map(subProd => {
                const produtoPrincipal = produtosMap[subProd["Produto Vinculado"]];
                return {
                    "Produto": subProd["Produto Vinculado"] || "", "SubProduto": subProd.SubProduto || "", "Categoria": (produtoPrincipal ? produtoPrincipal.Categoria : subProd.Categoria) || "",
                    "Fornecedor": subProd.Fornecedor || "", "Tamanho": subProd.Tamanho || "", "UN": subProd.UN || "", "Fator": subProd.Fator || null, "NCM": subProd.NCM || "",
                    "CST": subProd.CST || "", "CFOP": subProd.CFOP || "", "Preço": null, "Preço por Fator": null, "Comprar": null, "Valor Total": null
                };
            });

            transaction.update(cotacaoRef, { itens: admin.firestore.FieldValue.arrayUnion(...novosItens) });
            return novosItens.length;
        });
        
        if (numItens > 0) {
             res.status(200).json({ success: true, numItens, message: `${numItens} itens acrescentados com sucesso.` });
        } else {
             res.status(200).json({ success: true, numItens: 0, message: "Nenhum novo item encontrado para os critérios selecionados." });
        }

    } catch (error) {
        logger.error(`ERRO CRÍTICO na rota /cotacaoindividual/acrescentar-itens:`, error);
        res.status(500).json({ success: false, message: `Erro geral no servidor: ${error.message}` });
    }
});