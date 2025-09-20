// functions/modules/cotacaoindividual.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";

export const cotacaoindividualRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const COTACOES_COLLECTION = 'cotacoes';
const PRODUTOS_COLLECTION = 'produtos';
const SUBPRODUTOS_COLLECTION = 'subprodutos';
const FORNECEDORES_COLLECTION = 'fornecedores';
const CADASTROS_COLLECTION = 'cadastros';

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
 * ESTA FUNÇÃO FOI CORRIGIDA PARA LER A ESTRUTURA ANINHADA DE DADOS.
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

        // Itera sobre cada documento de cotação
        for (const doc of cotacoesSnapshot.docs) {
            const cotacao = doc.data();
            // Verifica se o array 'produtos' existe
            if (cotacao.produtos && Array.isArray(cotacao.produtos)) {
                // Itera sobre cada grupo de produto dentro da cotação
                for (const produtoGrupo of cotacao.produtos) {
                    const nomeProduto = produtoGrupo.Produto ? String(produtoGrupo.Produto).trim() : null;

                    // Se o produto principal ainda não tem 3 valores, procuramos nos seus itens
                    if (nomeProduto && (!valoresComprasPorProduto[nomeProduto] || valoresComprasPorProduto[nomeProduto].length < 3)) {
                        if (produtoGrupo.itens && Array.isArray(produtoGrupo.itens)) {
                            // Soma o valor 'Comprar' de todos os itens deste grupo
                            let totalComprarDoGrupo = 0;
                            for (const item of produtoGrupo.itens) {
                                const quantidade = cotacaoindividual_parseNumeroPtBr(item.Comprar);
                                if (Number.isFinite(quantidade) && quantidade > 0) {
                                    totalComprarDoGrupo += quantidade;
                                }
                            }

                            // Se houve compra para este grupo de produto, adiciona como um valor de compra
                            if (totalComprarDoGrupo > 0) {
                                if (!valoresComprasPorProduto[nomeProduto]) {
                                    valoresComprasPorProduto[nomeProduto] = [];
                                }
                                valoresComprasPorProduto[nomeProduto].push(totalComprarDoGrupo);
                            }
                        }
                    }
                }
            }
        }

        // Calcula a média para cada produto que teve valores encontrados
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
 * ESTA FUNÇÃO FOI ATUALIZADA PARA ENVIAR OS DADOS NO NÍVEL DO GRUPO DE PRODUTO.
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
      return { produtos: [], dataAbertura: null };
    }

    const cotacao = docSnap.data();

    if (!cotacao.produtos || !Array.isArray(cotacao.produtos)) {
      logger.warn(`Cotação ID '${idCotacaoAlvo}' não possui a estrutura de produtos aninhados esperada.`);
      return { produtos: [], dataAbertura: cotacao['Data Abertura'] || null };
    }

    const produtosEnriquecidos = cotacao.produtos.map((grupoProduto) => {
      const nomeProdutoPrincipal = grupoProduto.Produto ? String(grupoProduto.Produto).trim() : null;

      let estoqueMinimo = null;
      let demandaMedia = null;

      if (nomeProdutoPrincipal) {
        estoqueMinimo = Object.prototype.hasOwnProperty.call(mapaEstoqueMinimo, nomeProdutoPrincipal)
          ? mapaEstoqueMinimo[nomeProdutoPrincipal]
          : null;
        demandaMedia = Object.prototype.hasOwnProperty.call(mapaDemandaMedia, nomeProdutoPrincipal)
          ? mapaDemandaMedia[nomeProdutoPrincipal]
          : null;
      }

      // Normaliza cada item e preserva o subproduto original persistido
      const itensFormatados = (grupoProduto.itens || []).map((item) => ({
        ...item,
        Produto: nomeProdutoPrincipal,
        _subProdutoOriginalPersistido: item.SubProduto || item.Subproduto || null
      }));

      return {
        ...grupoProduto,
        itens: itensFormatados,
        // resumo do produto principal (usado na UI)
        estoqueMinimoProdutoPrincipal: estoqueMinimo,
        demandaMediaProdutoPrincipal: demandaMedia,
        estoqueAtualProdutoPrincipal: Object.prototype.hasOwnProperty.call(grupoProduto, 'Estoque Atual')
          ? grupoProduto['Estoque Atual']
          : null
      };
    });

    const dataAbertura =
      cotacao['Data Abertura'] && cotacao['Data Abertura'].toDate
        ? cotacao['Data Abertura'].toDate().toISOString()
        : null;

    logger.info(
      `cotacaoindividual_buscarProdutosPorIdCotacao: ${produtosEnriquecidos.length} grupos de produtos encontrados e enriquecidos para ID '${idCotacaoAlvo}'.`
    );

    return {
      produtos: produtosEnriquecidos,
      dataAbertura
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
cotacaoindividualRouter.post('/detalhes', async (req, res) => {
  const { idCotacao } = req.body;
  logger.info(`API: Recebida requisição para obter detalhes da cotação ID '${idCotacao}'.`);

  try {
    if (!idCotacao) {
      return res.status(400).json({ success: false, message: 'ID da Cotação não fornecido.' });
    }

    const resultado = await cotacaoindividual_buscarProdutosPorIdCotacao(idCotacao);
    if (resultado === null) {
      return res
        .status(500)
        .json({ success: false, message: `Falha ao buscar produtos for cotação ID ${idCotacao}.` });
    }

    return res.status(200).json({
      success: true,
      dados: resultado.produtos,
      dataAbertura: resultado.dataAbertura,
      cabecalhos: [
        'SubProduto',
        'Fornecedor',
        'Tamanho',
        'UN',
        'Fator',
        'Preço',
        'Preço por Fator',
        'Comprar',
        'Valor Total'
      ],
      message: `Dados da cotação ${idCotacao} carregados com sucesso.`
    });
  } catch (error) {
    logger.error(`ERRO na rota /detalhes para ID '${idCotacao}':`, error);
    return res.status(500).json({ success: false, message: 'Erro no servidor ao processar detalhes da cotação.' });
  }
});

/**
 * Rota para salvar a alteração de uma única célula em um item da cotação.
 */
cotacaoindividualRouter.post('/salvar-celula', async (req, res) => {
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
        logger.error(`ERRO na rota /salvar-celula:`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});


/**
 * Rota para salvar um conjunto de alterações de um item (vindo do modal de detalhes).
 */
cotacaoindividualRouter.post('/salvar-detalhes-item', async (req, res) => {
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
            const produtosArray = cotacao.produtos || [];
            let itemModificado = false;

            const produtosAtualizados = produtosArray.map(grupoProduto => {
                // Se não for o grupo de produto correto, retorne como está
                if (grupoProduto.Produto !== identificadoresLinha.Produto) {
                    return grupoProduto;
                }

                // Encontre o índice do item a ser atualizado dentro do grupo
                const itemIndex = (grupoProduto.itens || []).findIndex(item =>
                    (item.SubProduto || item.Subproduto) === identificadoresLinha.SubProdutoChave &&
                    item.Fornecedor === identificadoresLinha.Fornecedor
                );

                // Se o item não for encontrado, retorne o grupo como está
                if (itemIndex === -1) {
                    return grupoProduto;
                }
                
                // Crie uma cópia atualizada dos itens
                const itensAtualizados = [...grupoProduto.itens];
                const itemOriginal = itensAtualizados[itemIndex];
                
                // Mescla as alterações no item
                itensAtualizados[itemIndex] = { ...itemOriginal, ...alteracoes };
                itemModificado = true;

                // Retorna o grupo de produto com a lista de itens atualizada
                return { ...grupoProduto, itens: itensAtualizados };
            });

            if (!itemModificado) {
                throw new Error("Item específico não encontrado na cotação para atualizar.");
            }
            
            // Atualiza o documento inteiro com o novo array de produtos
            transaction.update(docRef, { produtos: produtosAtualizados });
        });

        res.status(200).json({
            success: true,
            message: "Detalhes do item atualizados com sucesso!",
            novoSubProdutoNomeSeAlterado: alteracoes.SubProduto
        });

    } catch (error) {
        logger.error(`ERRO na rota /salvar-detalhes-item:`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * Rota para acrescentar novos itens a uma cotação existente.
 */
cotacaoindividualRouter.post('/acrescentar-itens', async (req, res) => {
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
        logger.error(`ERRO CRÍTICO na rota /acrescentar-itens:`, error);
        res.status(500).json({ success: false, message: `Erro geral no servidor: ${error.message}` });
    }
});

//####################################################################################################
// MÓDULO: COTACAO INDIVIDUAL (SERVER-SIDE)
// BLOCO ETAPAS - Realiza as funções do menu etapas.
//####################################################################################################

/**
 * ETAPA 1: Salva os dados da contagem de estoque.
 * Atualiza o estoque mínimo na coleção 'produtos' e os dados de 'Estoque Atual' e 'Comprar' na cotação.
 */
cotacaoindividualRouter.post('/salvar-contagem', async (req, res) => {
    const { idCotacao, dadosContagem } = req.body;
    logger.info(`API: Salvando contagem de estoque para cotação ID '${idCotacao}'.`, { itemCount: dadosContagem.length });

    if (!idCotacao || !Array.isArray(dadosContagem) || dadosContagem.length === 0) {
        return res.status(400).json({ success: false, message: "Dados insuficientes para salvar a contagem." });
    }

    const db = admin.firestore();
    const batch = db.batch();

    try {
        // 1. Atualizar Estoque Mínimo na coleção 'produtos'
        const produtosRef = db.collection(PRODUTOS_COLLECTION);
        for (const item of dadosContagem) {
            if (item?.Produto && (item?.['Estoque Mínimo'] !== undefined)) {
                const prodSnap = await produtosRef.where('Produto', '==', String(item.Produto).trim()).limit(1).get();
                if (!prodSnap.empty) {
                    const docRef = prodSnap.docs[0].ref;
                    const estoqueMin = Number(item['Estoque Mínimo']) || 0;
                    batch.update(docRef, { 'Estoque Mínimo': estoqueMin });
                }
            }
        }

        // 2. Atualizar 'Estoque Atual' e 'Comprar' dentro da cotação (estrutura aninhada em produtos[].itens)
        const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));
        const cotacaoSnap = await cotacaoRef.get();
        if (!cotacaoSnap.exists) {
            return res.status(404).json({ success: false, message: "Cotação não encontrada." });
        }

        const cotacaoData = cotacaoSnap.data();
        const produtosAtualizados = (cotacaoData.produtos || []).map(grupo => {
            const itensAtualizados = (grupo.itens || []).map(item => {
                const encontrado = dadosContagem.find(d =>
                    String(d.Produto).trim() === String(grupo.Produto).trim() &&
                    String(d.SubProduto).trim() === String(item.SubProduto || item.Subproduto).trim()
                );
                if (!encontrado) return item;

                const estoqueAtual = Number(encontrado['Estoque Atual'] ?? item['Estoque Atual'] ?? 0);
                const comprar = Number(encontrado['Comprar'] ?? item['Comprar'] ?? 0);

                return {
                    ...item,
                    ['Estoque Atual']: estoqueAtual,
                    ['Comprar']: comprar
                };
            });

            return { ...grupo, itens: itensAtualizados };
        });

        batch.update(cotacaoRef, {
            produtos: produtosAtualizados,
            "Status da Cotação": "Contagem de Estoque"
        });

        await batch.commit();

        res.status(200).json({ success: true, message: "Contagem de estoque salva com sucesso!" });

    } catch (error) {
        logger.error(`Erro ao salvar contagem de estoque para cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 2: Retira produtos principais (e seus subprodutos) de uma cotação.
 */
cotacaoindividualRouter.post('/retirar-produtos', async (req, res) => {
    const { idCotacao, nomesProdutosPrincipaisParaExcluir } = req.body;
    logger.info(`API: Retirando produtos da cotação ID '${idCotacao}'.`, { produtos: nomesProdutosPrincipaisParaExcluir });

    if (!idCotacao || !Array.isArray(nomesProdutosPrincipaisParaExcluir)) {
        return res.status(400).json({ success: false, message: "Dados inválidos." });
    }

    const db = admin.firestore();
    const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));

    try {
        const docSnap = await cotacaoRef.get();
        if (!docSnap.exists) {
            throw new Error("Cotação não encontrada.");
        }

        const cotacaoData = docSnap.data();

        const produtosFiltrados = (cotacaoData.produtos || []).filter(grupo =>
            !nomesProdutosPrincipaisParaExcluir.includes(String(grupo.Produto).trim())
        );

        await cotacaoRef.update({ produtos: produtosFiltrados });

        res.status(200).json({ success: true, message: "Produtos retirados com sucesso!" });
    } catch (error) {
        logger.error(`Erro ao retirar produtos da cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 3: Atualiza o status da cotação. A lógica de links de fornecedor foi removida
 * pois não se aplica da mesma forma (será tratada em um módulo de portal separado).
 */
cotacaoindividualRouter.post('/atualizar-status', async (req, res) => {
    const { idCotacao, novoStatus } = req.body;
    logger.info(`API: Atualizando status da cotação ID '${idCotacao}' para '${novoStatus}'.`);

    if (!idCotacao || !novoStatus) {
        return res.status(400).json({ success: false, message: "ID da cotação e novo status são obrigatórios." });
    }

    const db = admin.firestore();
    const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));

    try {
        await cotacaoRef.update({ "Status da Cotação": novoStatus });
        res.status(200).json({ success: true, message: `Status atualizado para "${novoStatus}".` });
    } catch (error) {
        logger.error(`Erro ao atualizar status da cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 4: Retira subprodutos específicos de uma cotação.
 */
cotacaoindividualRouter.post('/retirar-subprodutos', async (req, res) => {
    const { idCotacao, subprodutosParaExcluir } = req.body;
    logger.info(`API: Retirando subprodutos da cotação ID '${idCotacao}'.`, { subprodutos: subprodutosParaExcluir });

    if (!idCotacao || !Array.isArray(subprodutosParaExcluir)) {
        return res.status(400).json({ success: false, message: "Dados inválidos." });
    }

    const db = admin.firestore();
    const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));

    try {
        const docSnap = await cotacaoRef.get();
        if (!docSnap.exists) {
            throw new Error("Cotação não encontrada.");
        }

        const cotacaoData = docSnap.data();

        // Remove itens cujo SubProduto esteja na lista
        const produtosAtualizados = (cotacaoData.produtos || []).map(grupo => {
            const itensFiltrados = (grupo.itens || []).filter(item =>
                !subprodutosParaExcluir.includes(String(item.SubProduto || item.Subproduto).trim())
            );
            return { ...grupo, itens: itensFiltrados };
        }).filter(grupo => (grupo.itens || []).length > 0);

        await cotacaoRef.update({ produtos: produtosAtualizados });

        res.status(200).json({ success: true, message: "Subprodutos sem preço retirados com sucesso." });
    } catch (error) {
        logger.error(`Erro ao retirar subprodutos da cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 5: Busca dados para a etapa de faturamento.
 */
cotacaoindividualRouter.get('/dados-faturamento', async (req, res) => {
    logger.info("API: Buscando dados para etapa de faturamento.");
    const db = admin.firestore();

    try {
        // Busca empresas (cadastros)
        const empresasSnap = await db.collection('cadastros').get();
        const empresas = empresasSnap.docs.map(doc => doc.data().Empresas).filter(Boolean);

        // Busca pedidos mínimos da coleção 'fornecedores'
        const fornecedoresSnap = await db.collection('fornecedores').get();
        const pedidosMinimos = {};
        fornecedoresSnap.forEach(doc => {
            const data = doc.data();
            const valorMinimo = parseFloat(String(data['Pedido Mínimo (R$)'] || '0').replace(',', '.'));
            if (data.Fornecedor && valorMinimo > 0) {
                pedidosMinimos[data.Fornecedor] = valorMinimo;
            }
        });

        res.status(200).json({ success: true, empresas, pedidosMinimos });
    } catch (error) {
        logger.error("Erro ao buscar dados para faturamento:", error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 5: Salva as empresas faturadas em lote para uma cotação.
 */
cotacaoindividualRouter.post('/salvar-faturamento', async (req, res) => {
    const { idCotacao, alteracoes } = req.body;
    logger.info(`API: Salvando faturamento em lote para cotação ID '${idCotacao}'.`, { alteracoesCount: alteracoes?.length });

    if (!idCotacao || !Array.isArray(alteracoes)) {
        return res.status(400).json({ success: false, message: "Dados inválidos." });
    }

    const db = admin.firestore();
    const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));

    try {
        const docSnap = await cotacaoRef.get();
        if (!docSnap.exists) {
            throw new Error("Cotação não encontrada.");
        }

        const cotacaoData = docSnap.data();
        const produtosAtualizados = (cotacaoData.produtos || []).map(grupo => {
            const itensAtualizados = (grupo.itens || []).map(item => {
                const chave = {
                    Produto: String(grupo.Produto).trim(),
                    SubProduto: String(item.SubProduto || item.Subproduto).trim(),
                    Fornecedor: String(item.Fornecedor || '').trim()
                };
                const alter = alteracoes.find(a =>
                    String(a.Produto).trim() === chave.Produto &&
                    String(a.SubProduto).trim() === chave.SubProduto &&
                    String(a.Fornecedor).trim() === chave.Fornecedor
                );
                return alter ? { ...item, ['Empresa Faturada']: String(alter['Empresa Faturada'] || '').trim() } : item;
            });
            return { ...grupo, itens: itensAtualizados };
        });

        await cotacaoRef.update({ produtos: produtosAtualizados });

        res.status(200).json({ success: true, message: "Empresas faturadas atualizadas com sucesso." });
    } catch (error) {
        logger.error(`Erro ao salvar faturamento da cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 6: Busca dados para a etapa de condições de pagamento.
 */
cotacaoindividualRouter.get('/dados-condicoes', async (req, res) => {
    logger.info("API: Buscando dados para etapa de condições de pagamento.");
    const db = admin.firestore();
    try {
        const fornecedoresSnap = await db.collection('fornecedores').get();
        const condicoes = {};
        fornecedoresSnap.forEach(doc => {
            const data = doc.data();
            if (data.Fornecedor && data['Condições de Pagamento']) {
                condicoes[data.Fornecedor] = data['Condições de Pagamento'];
            }
        });
        res.status(200).json({ success: true, condicoes });
    } catch (error) {
        logger.error("Erro ao buscar condições de pagamento:", error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 6: Salva as condições de pagamento para os itens de uma cotação.
 */
cotacaoindividualRouter.post('/salvar-condicoes', async (req, res) => {
    const { idCotacao, dadosPagamento } = req.body;
    logger.info(`API: Salvando condições de pagamento para cotação ID '${idCotacao}'.`, { count: dadosPagamento.length });

    if (!idCotacao || !Array.isArray(dadosPagamento)) {
        return res.status(400).json({ success: false, message: "Dados inválidos." });
    }

    const db = admin.firestore();
    const cotacaoRef = db.collection(COTACOES_COLLECTION).doc(String(idCotacao));

    try {
        const docSnap = await cotacaoRef.get();
        if (!docSnap.exists) {
            throw new Error("Cotação não encontrada.");
        }

        const cotacaoData = docSnap.data();

        const produtosAtualizados = (cotacaoData.produtos || []).map(grupo => {
            const itensAtualizados = (grupo.itens || []).map(item => {
                const chave = {
                    Produto: String(grupo.Produto).trim(),
                    SubProduto: String(item.SubProduto || item.Subproduto).trim(),
                    Fornecedor: String(item.Fornecedor || '').trim()
                };
                const info = dadosPagamento.find(a =>
                    String(a.Produto).trim() === chave.Produto &&
                    String(a.SubProduto).trim() === chave.SubProduto &&
                    String(a.Fornecedor).trim() === chave.Fornecedor
                );
                if (!info) return item;

                return {
                    ...item,
                    ['Condição de Pagamento']: String(info['Condição de Pagamento'] || '').trim(),
                    ['Empresa Faturada']: String(info['Empresa Faturada'] || item['Empresa Faturada'] || '').trim()
                };
            });
            return { ...grupo, itens: itensAtualizados };
        });

        await cotacaoRef.update({ produtos: produtosAtualizados, "Status da Cotação": "Definindo Condições de Pagamento" });

        res.status(200).json({ success: true, message: "Condições de pagamento salvas com sucesso." });
    } catch (error) {
        logger.error(`Erro ao salvar condições de pagamento da cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});

/**
 * ETAPA 7: Busca dados agrupados para a impressão dos pedidos.
 */
cotacaoindividualRouter.get('/cotacaoindividual/dados-impressao/:idCotacao', async (req, res) => {
    const { idCotacao } = req.params;
    logger.info(`API: Buscando dados para impressão da cotação ID '${idCotacao}'.`);
    
    const db = admin.firestore();
    try {
        // 1. Buscar CNPJs das empresas
        const cadastrosSnap = await db.collection('cadastros').get();
        const mapaCnpj = {};
        cadastrosSnap.forEach(doc => {
            const data = doc.data();
            if (data.Empresas && data.CNPJ) {
                mapaCnpj[data.Empresas.trim()] = data.CNPJ;
            }
        });

        // 2. Buscar a cotação
        const cotacaoDoc = await db.collection(COTACOES_COLLECTION).doc(String(idCotacao)).get();
        if (!cotacaoDoc.exists) {
            return res.status(404).json({ success: false, message: "Cotação não encontrada." });
        }

        const cotacaoData = cotacaoDoc.data();
        const pedidosTemporarios = {};

        // 3. Processar e agrupar itens
        if (cotacaoData.produtos && Array.isArray(cotacaoData.produtos)) {
            cotacaoData.produtos.forEach(grupo => {
                (grupo.itens || []).forEach(item => {
                    const nomeFornecedor = String(item.Fornecedor || '').trim() || 'Fornecedor não informado';
                    const nomeEmpresa = String(item['Empresa Faturada'] || '').trim() || 'Empresa não definida';

                    const chaveUnica = `${nomeFornecedor}__${nomeEmpresa}`;

                    if (!pedidosTemporarios[chaveUnica]) {
                        pedidosTemporarios[chaveUnica] = {
                            fornecedor: nomeFornecedor,
                            empresaFaturada: nomeEmpresa,
                            cnpj: mapaCnpj[nomeEmpresa.trim()] || 'Não informado',
                            condicaoPagamento: item['Condição de Pagamento'] || 'Não informada',
                            itens: [],
                            totalPedido: 0
                        };
                    }

                    const itemPedido = {
                        subProduto: item.SubProduto || item.Subproduto,
                        un: item.UN,
                        fator: Number(item.Fator) || 0,
                        preco: Number(item.Preço) || 0,
                        precoPorFator: Number(item['Preço por Fator']) || 0,
                        comprar: Number(item.Comprar) || 0,
                        valorTotal: Number(item['Valor Total']) || 0
                    };

                    pedidosTemporarios[chaveUnica].itens.push(itemPedido);
                    pedidosTemporarios[chaveUnica].totalPedido += itemPedido.valorTotal || 0;
                });
            });
        }

        // 4. Transformar em array agrupado por fornecedor
        const dadosFinaisAgrupados = {};
        for (const chave in pedidosTemporarios) {
            const pedido = pedidosTemporarios[chave];
            if (!dadosFinaisAgrupados[pedido.fornecedor]) {
                dadosFinaisAgrupados[pedido.fornecedor] = [];
            }
            dadosFinaisAgrupados[pedido.fornecedor].push(pedido);
        }

        res.status(200).json({ success: true, dados: dadosFinaisAgrupados });

    } catch (error) {
        logger.error(`Erro ao buscar dados para impressão da cotação ID '${idCotacao}':`, error);
        res.status(500).json({ success: false, message: `Erro no servidor: ${error.message}` });
    }
});
