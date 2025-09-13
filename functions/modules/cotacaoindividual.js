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
            if (cotacao.produtos && Array.isArray(cotacao.produtos)) {
                for (const produtoGrupo of cotacao.produtos) {
                    if (produtoGrupo.itens && Array.isArray(produtoGrupo.itens)) {
                        for (const item of produtoGrupo.itens) {
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
    
    // As funções para criar mapas de estoque e demanda continuam as mesmas
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
            return { produtos: [], dataAbertura: null };
        }

        const cotacao = docSnap.data();

        // Verificamos se a estrutura 'produtos' com 'itens' aninhados existe
        if (!cotacao.produtos || !Array.isArray(cotacao.produtos)) {
            logger.warn(`Cotação ID '${idCotacaoAlvo}' não possui a estrutura de produtos aninhados esperada.`);
            return { produtos: [], dataAbertura: cotacao['Data Abertura'] || null };
        }

        // Itera sobre a estrutura aninhada para enriquecer os dados sem achatar a lista
        const produtosEnriquecidos = cotacao.produtos.map(grupoProduto => {
            const nomeProdutoPrincipal = grupoProduto.Produto ? String(grupoProduto.Produto).trim() : null;

            const itensEnriquecidos = (grupoProduto.itens || []).map(item => {
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
                
                // Retorna o item com os novos campos e a referência ao produto original
                return {
                    ...item,
                    Produto: nomeProdutoPrincipal, // Garante que o nome do produto principal está no item
                    EstoqueMinimoProdutoPrincipal: estoqueMinimo,
                    DemandaMediaProdutoPrincipal: demandaMedia,
                    _subProdutoOriginalPersistido: item.SubProduto || item.Subproduto || null // Garante consistência
                };
            });
            
            // Retorna o grupo do produto com seus itens já enriquecidos
            return {
                ...grupoProduto,
                itens: itensEnriquecidos
            };
        });
        
        const dataAbertura = cotacao['Data Abertura'] ? cotacao['Data Abertura'].toDate().toISOString() : null;

        logger.info(`cotacaoindividual_buscarProdutosPorIdCotacao: ${produtosEnriquecidos.length} grupos de produtos encontrados e enriquecidos para ID '${idCotacaoAlvo}'.`);
        
        return {
            produtos: produtosEnriquecidos,
            dataAbertura: dataAbertura
        };

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
        
        const resultado = await cotacaoindividual_buscarProdutosPorIdCotacao(idCotacao);

        if (resultado === null) {
            return res.status(500).json({ success: false, message: `Falha ao buscar produtos para cotação ID ${idCotacao}.` });
        }
        
        // CORREÇÃO: Enviamos os dados já agrupados, a data de abertura e a lista de cabeçalhos fixa.
        res.status(200).json({
            success: true,
            dados: resultado.produtos, // A estrutura aninhada de produtos e itens
            dataAbertura: resultado.dataAbertura,
            cabecalhos: ["SubProduto", "Fornecedor", "Tamanho", "UN", "Fator", "Preço", "Preço por Fator", "Comprar", "Valor Total"],
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
        const cotacaoDocRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));
        
        // Colunas que, quando alteradas, devem ser sincronizadas com a coleção de subprodutos.
        const COLUNAS_SINCRONIZAVEIS_COM_SUBPRODUTOS = ['SubProduto', 'Tamanho', 'UN', 'Fator'];

        let resultadoFinal = {};

        await db.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(cotacaoDocRef);
            if (!docSnap.exists) {
                throw new Error("Cotação não encontrada.");
            }

            const cotacaoData = docSnap.data();
            const produtosArray = cotacaoData.produtos || [];
            let itemAtualizado = false;
            let novoSubProdutoNome = null;

            // Encontra e atualiza o item dentro da estrutura aninhada da cotação
            const produtosAtualizados = produtosArray.map(grupoProduto => {
                if (grupoProduto.Produto === identificadoresLinha.Produto) {
                    const itemIndex = (grupoProduto.itens || []).findIndex(item =>
                        (item.SubProduto || item.Subproduto) === identificadoresLinha.SubProdutoChave &&
                        item.Fornecedor === identificadoresLinha.Fornecedor
                    );

                    if (itemIndex !== -1) {
                        const itensAtualizados = [...grupoProduto.itens];
                        const itemOriginal = itensAtualizados[itemIndex];
                        
                        // Converte o novo valor para número, se aplicável
                        const camposNumericos = ['Preço', 'Comprar', 'Fator'];
                        const valorFinal = camposNumericos.includes(colunaAlterada)
                            ? cotacaoindividual_parseNumeroPtBr(novoValor)
                            : novoValor;

                        itensAtualizados[itemIndex] = { ...itemOriginal, [colunaAlterada]: valorFinal };

                        // Recalcula campos dependentes se uma coluna "gatilho" foi alterada
                        const colunasTriggerCalculo = ['Preço', 'Comprar', 'Fator'];
                        if (colunasTriggerCalculo.includes(colunaAlterada)) {
                            const preco = cotacaoindividual_parseNumeroPtBr(itensAtualizados[itemIndex]['Preço']) || 0;
                            const comprar = cotacaoindividual_parseNumeroPtBr(itensAtualizados[itemIndex]['Comprar']) || 0;
                            const fator = cotacaoindividual_parseNumeroPtBr(itensAtualizados[itemIndex]['Fator']) || 0;

                            itensAtualizados[itemIndex]['Valor Total'] = preco * comprar;
                            itensAtualizados[itemIndex]['Preço por Fator'] = (fator !== 0) ? (preco / fator) : 0;
                        }
                        
                        // Se o nome do SubProduto mudou, precisamos do novo nome para o retorno
                        if (colunaAlterada === 'SubProduto') {
                           novoSubProdutoNome = novoValor;
                        }
                        
                        itemAtualizado = true;
                        resultadoFinal.valoresCalculados = {
                           valorTotal: itensAtualizados[itemIndex]['Valor Total'],
                           precoPorFator: itensAtualizados[itemIndex]['Preço por Fator']
                        };
                        
                        return { ...grupoProduto, itens: itensAtualizados };
                    }
                }
                return grupoProduto;
            });

            if (!itemAtualizado) {
                throw new Error("Item específico não foi encontrado na cotação para ser atualizado.");
            }

            // Atualiza o documento da cotação com o array de produtos modificado
            transaction.update(cotacaoDocRef, { produtos: produtosAtualizados });
            
            // Lógica para sincronizar com a coleção 'subprodutos'
            if (COLUNAS_SINCRONIZAVEIS_COM_SUBPRODUTOS.includes(colunaAlterada)) {
                const subProdutosQuery = await db.collection(SUBPRODUTOS_COLLECTION)
                    .where('Produto Vinculado', '==', identificadoresLinha.Produto)
                    .where('SubProduto', '==', identificadoresLinha.SubProdutoChave)
                    .where('Fornecedor', '==', identificadoresLinha.Fornecedor)
                    .limit(1)
                    .get();

                if (!subProdutosQuery.empty) {
                    const subProdutoDocRef = subProdutosQuery.docs[0].ref;
                    const atualizacao = { [colunaAlterada]: novoValor };
                    transaction.update(subProdutoDocRef, atualizacao);
                    logger.info(`Sincronização: Subproduto ${subProdutoDocRef.id} atualizado com { ${colunaAlterada}: "${novoValor}" }.`);
                } else {
                     logger.warn(`Sincronização: Subproduto correspondente não encontrado para ${JSON.stringify(identificadoresLinha)}.`);
                }
            }
             if (novoSubProdutoNome) {
                resultadoFinal.novoSubProdutoNomeSeAlterado = novoSubProdutoNome;
            }
        });
        
        res.status(200).json({ 
            success: true, 
            message: `Coluna '${colunaAlterada}' atualizada com sucesso.`,
            ...resultadoFinal
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