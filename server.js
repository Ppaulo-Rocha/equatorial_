const express = require('express');
const { downloadInvoice } = require('./automation');

const app = express();
app.use(express.json());

// --- CONFIGURAÇÕES ---
const PORT = 2031;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '057ebcdc28b0b95cabe45341b209d28d';

// --- ROTA DE HEALTHCHECK ---
app.get('/', (req, res) => {
    res.status(200).send('Equatorial Bot Online 🤖');
});

app.post('/webhook/fatura', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: 'Não autorizado.' });
    }

    const {
        email = 'adm.financeiro@mov.pro.br',
        senha = 'Movfibra15070@',
        conta = '003014474705'
    } = req.body;

    console.log(`\n=== Nova solicitação via API para conta: ${conta} ===`);

    try {
        const resultado = await downloadInvoice(email, senha, conta);
        return res.json(resultado);
    } catch (error) {
        console.error("Erro ao processar:", error.message);
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor API rodando na porta ${PORT}`);
    console.log(`Use POST /webhook/fatura com Authorization: Bearer ${AUTH_TOKEN}`);
});