// functions/modules/fornecedores.js
import { Router } from "express";
import logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { google } from "googleapis";


export const fornecedoresRouter = Router();

// --- CONSTANTES DE CONFIGURAÇÃO ---
const SPREADSHEET_ID = '1CFbP6_VC4TOJXITwO-nvxu6IX1brAYJNUCaRW0VDXDY';
const SHEET_NAME = 'Fornecedores';
const FIRESTORE_COLLECTION = 'fornecedores';

/**
 * Função utilitária para converter dados da planilha (array de arrays) para um array de objetos.
 */
function fornecedores_convertSheetDataToObject(data) {
    if (!data || data.length < 2) {
        return [];
    }
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
        // Autenticação foi AJUSTADA para usar as credenciais automáticas do Firebase
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // Busca os dados da planilha
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
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
                const docRef = db.collection(FIRESTORE_COLLECTION).doc(String(fornecedor.ID));
                batch.set(docRef, fornecedor, { merge: true }); // Use merge para não sobrescrever dados existentes com campos vazios
                count++;
            }
        });

        await batch.commit();

        logger.info(`API: ${count} fornecedores importados/atualizados com sucesso.`);
        res.status(200).json({ success: true, message: `${count} fornecedores importados/atualizados com sucesso!` });

    } catch (e) {
        logger.error("Erro ao importar fornecedores do Google Sheets:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para obter dados paginados de fornecedores do Firestore.
 */
fornecedoresRouter.post('/fornecedores/list', async (req, res) => {
    logger.info("API: Recebida requisição para listar fornecedores", { body: req.body });
    try {
        const { pagina = 1, itensPorPagina = 10, termoBusca = "" } = req.body;
        const db = admin.firestore();
        let query = db.collection(FIRESTORE_COLLECTION);

        // Atenção: A busca por "termoBusca" em todos os campos requer uma solução mais avançada
        // como um serviço de busca (ex: Algolia, Typesense) ou uma estrutura de dados dedicada no Firestore.
        // A implementação abaixo fará uma busca simples e ineficiente, lendo todos os documentos.
        // Para produção, considere otimizar esta parte.

        const snapshot = await query.orderBy('Fornecedor').get();
        if (snapshot.empty) {
            return res.status(200).json({
                cabecalhosParaExibicao: ["Fornecedor", "CNPJ", "Vendedor", "Telefone", "Email"],
                fornecedoresPaginados: [],
                totalItens: 0,
                paginaAtual: 1,
                totalPaginas: 1
            });
        }

        let fornecedores = [];
        snapshot.forEach(doc => {
            fornecedores.push({ ID: doc.id, ...doc.data() });
        });

        let fornecedoresFiltrados = fornecedores;
        if (termoBusca) {
            const termoNormalizado = termoBusca.toLowerCase().trim();
            fornecedoresFiltrados = fornecedores.filter(f =>
                Object.values(f).some(val => String(val).toLowerCase().includes(termoNormalizado))
            );
        }

        const totalItens = fornecedoresFiltrados.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPagina) || 1;
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
 * Rota para criar um novo fornecedor no Firestore.
 */
fornecedoresRouter.post('/fornecedores/create', async (req, res) => {
    logger.info("API: Recebida requisição para criar fornecedor", { body: req.body });
    try {
        const dadosNovoFornecedor = req.body;
        if (!dadosNovoFornecedor || !dadosNovoFornecedor["Fornecedor"]) {
            return res.status(400).json({ success: false, message: "Nome do Fornecedor é obrigatório." });
        }

        const db = admin.firestore();
        const novoFornecedorRef = db.collection(FIRESTORE_COLLECTION).doc();

        // Mapeia explicitamente os campos esperados para maior segurança
        const novoFornecedor = {
            "Fornecedor": dadosNovoFornecedor["Fornecedor"] || "",
            "CNPJ": dadosNovoFornecedor["CNPJ"] || "",
            "Categoria": dadosNovoFornecedor["Categoria"] || "",
            "Vendedor": dadosNovoFornecedor["Vendedor"] || "",
            "Telefone": dadosNovoFornecedor["Telefone"] || "",
            "Email": dadosNovoFornecedor["Email"] || "",
            "Dias de Pedido": dadosNovoFornecedor["Dias de Pedido"] || "",
            "Dia de Faturamento": dadosNovoFornecedor["Dia de Faturamento"] || "",
            "Dias de Entrega": dadosNovoFornecedor["Dias de Entrega"] || "",
            "Pedido Mínimo (R$)": dadosNovoFornecedor["Pedido Mínimo (R$)"] || "",
            "Condições de Pagamento": dadosNovoFornecedor["Condições de Pagamento"] || "",
            "Regime Tributário": dadosNovoFornecedor["Regime Tributário"] || "",
            "Contato Financeiro": dadosNovoFornecedor["Contato Financeiro"] || "",
            "ID": novoFornecedorRef.id, // Adiciona o ID gerado
            "Data de Cadastro": new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        };

        await novoFornecedorRef.set(novoFornecedor);

        res.status(201).json({ success: true, message: "Fornecedor criado com sucesso!", novoId: novoFornecedorRef.id });
    } catch (e) {
        logger.error("Erro ao criar fornecedor:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para atualizar um fornecedor existente no Firestore.
 */
fornecedoresRouter.post('/fornecedores/update', async (req, res) => {
    logger.info("API: Recebida requisição para atualizar fornecedor", { body: req.body });
    try {
        const dadosParaAtualizar = req.body;
        const { ID } = dadosParaAtualizar;
        if (!ID) {
            return res.status(400).json({ success: false, message: "ID do fornecedor é obrigatório para atualização." });
        }

        const db = admin.firestore();
        const fornecedorRef = db.collection(FIRESTORE_COLLECTION).doc(String(ID));

        // Remove o ID do objeto para não salvá-lo como um campo dentro do documento
        delete dadosParaAtualizar.ID;

        await fornecedorRef.update(dadosParaAtualizar);

        res.status(200).json({ success: true, message: "Fornecedor atualizado com sucesso!" });
    } catch (e) {
        logger.error("Erro ao atualizar fornecedor:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * Rota para excluir um fornecedor e lidar com seus subprodutos no Firestore.
 */
fornecedoresRouter.post('/fornecedores/delete', async (req, res) => {
    const { idFornecedor, nomeFornecedorOriginal, deletarSubprodutosVinculados, realocacoesSubprodutos } = req.body;
    logger.info(`API: Processando exclusão do fornecedor ID ${idFornecedor}`, { body: req.body });

    try {
        const db = admin.firestore();
        const batch = db.batch();

        // 1. Deletar o fornecedor
        const fornecedorRef = db.collection(FIRESTORE_COLLECTION).doc(String(idFornecedor));
        batch.delete(fornecedorRef);

        // 2. Lidar com subprodutos vinculados
        const subprodutosQuery = db.collection('subprodutos').where('Fornecedor', '==', nomeFornecedorOriginal);
        const subprodutosSnapshot = await subprodutosQuery.get();

        if (!subprodutosSnapshot.empty) {
            if (deletarSubprodutosVinculados) {
                subprodutosSnapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
            } else if (realocacoesSubprodutos && realocacoesSubprodutos.length > 0) {
                const realocacoesMap = new Map(realocacoesSubprodutos.map(r => [r.subProdutoId, r.novoFornecedorNome]));
                subprodutosSnapshot.forEach(doc => {
                    const novoFornecedor = realocacoesMap.get(doc.id);
                    if (novoFornecedor) {
                        batch.update(doc.ref, { Fornecedor: novoFornecedor });
                    }
                });
            }
        }

        await batch.commit();
        res.status(200).json({ success: true, message: `Fornecedor '${nomeFornecedorOriginal}' e seus subprodutos (se aplicável) foram processados.` });

    } catch (e) {
        logger.error(`Erro ao excluir fornecedor ${idFornecedor}:`, e);
        res.status(500).json({ success: false, message: e.message });
    }
});


/**
 * Rota para obter subprodutos de um fornecedor do Firestore.
 */
fornecedoresRouter.post('/fornecedores/getSubprodutos', async (req, res) => {
    const { nomeFornecedor } = req.body;
    logger.info(`API: Buscando subprodutos para o fornecedor: ${nomeFornecedor}`);
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('subprodutos').where('Fornecedor', '==', nomeFornecedor).get();
        const itens = [];
        snapshot.forEach(doc => {
            itens.push({ id: doc.id, ...doc.data() });
        });
        res.status(200).json(itens);
    } catch (e) {
        logger.error(`Erro ao buscar subprodutos para ${nomeFornecedor}:`, e);
        res.status(500).json([]);
    }
});

/**
 * Rota para obter outros fornecedores (exceto um) do Firestore.
 */
fornecedoresRouter.post('/fornecedores/getOthers', async (req, res) => {
    const { idFornecedorExcluido } = req.body;
    logger.info(`API: Buscando outros fornecedores, exceto ID: ${idFornecedorExcluido}`);
    try {
        const db = admin.firestore();
        const snapshot = await db.collection(FIRESTORE_COLLECTION).where(admin.firestore.FieldPath.documentId(), '!=', String(idFornecedorExcluido)).get();
        const outros = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            outros.push({ id: doc.id, nome: data.Fornecedor });
        });
        res.status(200).json(outros);
    } catch (e) {
        logger.error(`Erro ao buscar outros fornecedores:`, e);
        res.status(500).json([]);
    }
});