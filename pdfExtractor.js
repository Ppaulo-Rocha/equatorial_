/**
 * PDF Extractor Module
 * Extracts invoice data from PDF base64 content using pdf2json
 */

const PDFParser = require('pdf2json');

/**
 * Extracts invoice data from a base64-encoded PDF
 * @param {string} base64Pdf - PDF content encoded in base64
 * @returns {Promise<Object>} Extracted invoice data
 */
async function extractInvoiceData(base64Pdf) {
    try {
        const buffer = Buffer.from(base64Pdf, 'base64');

        // Parse PDF to extract text
        const text = await new Promise((resolve, reject) => {
            const pdfParser = new PDFParser(null, 1); // 1 = text only

            pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
            pdfParser.on("pdfParser_dataReady", () => {
                resolve(pdfParser.getRawTextContent());
            });

            pdfParser.parseBuffer(buffer);
        });

        // Regex patterns for data extraction

        // Extract invoice number (only the number, not the series)
        const notaFiscalMatch = text.match(/NOTA\s+FISCAL\s+N[°º]?\s*(\d+)/i);

        // Extract total value
        const valorMatch = text.match(/Total\s+a\s+[Pp]agar[\s\S]{0,50}?R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i) ||
            text.match(/Valor[\s\S]{0,30}?R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);

        // Extract barcode
        const codigoBarrasMatch = text.match(/(\d{11,12}\s+\d{11,12}\s+\d{11,12}\s+\d{11,12}|\d{48})/);

        // Extract due date
        const vencimentoMatch = text.match(/Vencimento[\s\S]{0,30}?(\d{2}\/\d{2}\/\d{4})/i);

        // Extract account contract (typically 10 digits)
        const contaContratoMatch = text.match(/Conta\s+Contrato[\s\S]{0,30}?(\d{10})/i) ||
            text.match(/Conta\s+Contrato[\s\S]{0,30}?(\d+)/i);

        // Extract next reading date
        let proximaLeituraMatch = null;
        const leituraTableMatch = text.match(/Data\s+das[\s\S]{0,200}?Pr[óo]xima\s+Leitura[\s\S]{0,100}?Leituras\s+([\s\S]{0,150})/i);
        if (leituraTableMatch) {
            const dates = leituraTableMatch[1].match(/\d{2}\/\d{2}\/\d{4}/g);
            if (dates && dates.length >= 3) {
                proximaLeituraMatch = [null, dates[dates.length - 1]];
            }
        }

        // Fallback for next reading
        if (!proximaLeituraMatch) {
            proximaLeituraMatch = text.match(/Pr[óo]xima\s+Leitura[\s\S]{0,30}?(\d{2}\/\d{2}\/\d{4})/i);
        }

        // Clean up barcode (remove spaces)
        let codigoBarras = codigoBarrasMatch ? codigoBarrasMatch[0].replace(/\s/g, '') : null;

        // Fallback for barcode
        if (!codigoBarras) {
            const longNumberMatch = text.match(/\b\d{48}\b/);
            if (longNumberMatch) codigoBarras = longNumberMatch[0];
        }

        return {
            nota_fiscal: notaFiscalMatch ? notaFiscalMatch[1] : null,
            valor: valorMatch ? valorMatch[1] : null,
            codigo_barras: codigoBarras,
            data_vencimento: vencimentoMatch ? vencimentoMatch[1] : null,
            conta_contrato: contaContratoMatch ? contaContratoMatch[1] : null,
            proxima_leitura: proximaLeituraMatch ? proximaLeituraMatch[1] : null
        };

    } catch (error) {
        console.error(`Erro ao extrair dados do PDF: ${error.message}`);
        return {
            nota_fiscal: null,
            valor: null,
            codigo_barras: null,
            data_vencimento: null,
            conta_contrato: null,
            proxima_leitura: null,
            extraction_error: error.message
        };
    }
}

module.exports = { extractInvoiceData };
