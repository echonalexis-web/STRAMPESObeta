const fs = require('fs');
const path = require('path');
const pdfModule = require('pdf-parse');

const pdf = typeof pdfModule === 'function' ? pdfModule : null;
const PDFParse = pdfModule.PDFParse || pdfModule.default?.PDFParse;

async function parsePSOCPDF() {
  try {
    const fileName = 'PSOC_2.xls - NSCB_PSOC_2002.pdf';
    const filePath = path.join(__dirname, fileName);

    if (!fs.existsSync(filePath)) {
      console.error(`File "${fileName}" not found in project root!`);
      return;
    }

    console.log(`Reading "${fileName}"...`);
    const dataBuffer = fs.readFileSync(filePath);
    let extractedText = '';

    if (PDFParse) {
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      extractedText = result.text;
    } else if (pdf) {
      const data = await pdf(dataBuffer);
      extractedText = data.text;
    } else {
      throw new Error('Could not initialize pdf-parse.');
    }

    // Split text into individual tokens by newline or tab characters
    const rawTokens = extractedText.split(/[\n\r\t]+/);

    const cleanTitles = rawTokens
      .map(item => {
        return item
          .replace(/^\d+$/, '')          // Remove pure numeric strings (PSOC codes)
          .replace(/\b[a-z]?\d{3,4}\b/gi, '') // Remove code markers like t4131, 3450
          .replace(/\s+/g, ' ')           // Normalize multiple spaces into single spaces
          .trim();
      })
      .filter(title => {
        // Exclude short strings, page numbers, header titles, and empty values
        return (
          title.length > 3 &&
          !/^\d+$/.test(title) &&
          !/^Page \d+/i.test(title) &&
          !/^PSOC/i.test(title) &&
          !/^PHILIPPINE/i.test(title)
        );
      });

    // Remove duplicates and sort alphabetically
    const uniqueTitles = [...new Set(cleanTitles)].sort((a, b) => a.localeCompare(b));

    const outputPath = path.join(__dirname, 'ph_job_titles_complete.json');
    fs.writeFileSync(outputPath, JSON.stringify(uniqueTitles, null, 2));

    console.log(`\nSuccess! Extracted ${uniqueTitles.length} clean job titles.`);
    console.log(`Saved clean dataset to: ${outputPath}`);
  } catch (error) {
    console.error('Error parsing PDF:', error.message);
  }
}

parsePSOCPDF();