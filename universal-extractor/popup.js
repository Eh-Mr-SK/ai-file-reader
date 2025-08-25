// Import PDF.js library
import * as pdfjsLib from './lib/pdf.mjs';

// Configure the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

// DOM Elements
const fileInput = document.getElementById('fileInput');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');

// Event Listener
fileInput.addEventListener('change', handleFileSelect, false);

function updateStatus(message, isProcessing = false) {
  statusDiv.textContent = message;
  fileInput.disabled = isProcessing;
}

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  outputDiv.textContent = '';
  updateStatus(`Processing "${file.name}"...`, true);

  const fileExtension = file.name.split('.').pop().toLowerCase();
  const fileType = file.type;

  try {
    let extractedText = '';
    if (fileExtension === 'pdf') {
      extractedText = await extractTextFromPdf(file);
    } else if (fileExtension === 'docx') {
      extractedText = await extractTextFromDocx(file);
    } else if (fileType.startsWith('text/')) {
      extractedText = await extractTextFromTxt(file);
    } else if (fileType.startsWith('image/')) {
      extractedText = await extractTextFromImage(file);
    } else {
      throw new Error(`File type ".${fileExtension}" is not supported.`);
    }
    outputDiv.textContent = extractedText;
    updateStatus('Extraction successful!', false);
  } catch (error) {
    outputDiv.textContent = `Error: ${error.message}`;
    updateStatus('Extraction failed. Please try another file.', false);
  }
}

function extractTextFromTxt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error("Failed to read text file."));
    reader.readAsText(file);
  });
}

/**
 * **IMPROVED PDF EXTRACTION FUNCTION**
 * This version analyzes text coordinates to intelligently add spaces and newlines,
 * preventing the "gibberish" spacing issue.
 */
async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const typedarray = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    let lastY = -1; // Keep track of the last Y position to detect line breaks

    // Sort items by their vertical position, then horizontal
    const items = textContent.items.sort((a, b) => {
        if (a.transform[5] > b.transform[5]) return -1;
        if (a.transform[5] < b.transform[5]) return 1;
        if (a.transform[4] < b.transform[4]) return -1;
        if (a.transform[4] > b.transform[4]) return 1;
        return 0;
    });

    let lineText = '';
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) { // Threshold for new line
        fullText += lineText + '\n';
        lineText = '';
      }
      
      // Add a space if the horizontal gap is significant
      if (lineText.length > 0 && j > 0) {
        const prevItem = items[j - 1];
        const gap = item.transform[4] - (prevItem.transform[4] + prevItem.width);
        if (gap > 2) { // Threshold for a word space
          lineText += ' ';
        }
      }

      lineText += item.str;
      lastY = item.transform[5];
    }
    fullText += lineText + '\n\n'; // Add the last line of the page
  }
  return fullText;
}

async function extractTextFromDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
}

async function extractTextFromImage(file) {
    updateStatus('Initializing OCR engine...', true);
    const { TesseractWorker } = Tesseract;
    
    // Tesseract.js v5 uses a createScheduler/addWorker pattern
    const scheduler = Tesseract.createScheduler();
    const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                 updateStatus(`Recognizing text... ${Math.round(m.progress * 100)}%`, true);
            }
        },
    });
    scheduler.addWorker(worker);

    updateStatus('Recognizing text...', true);
    const { data: { text } } = await scheduler.addJob('recognize', file);
    await scheduler.terminate(); // Important to free up resources
    return text;
}