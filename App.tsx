import React, { useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { extractTransactionsFromImages } from './services/geminiService.ts';
import { Transaction, RedactionPage, RedactionRect } from './types.ts';
import { FileUpload } from './components/FileUpload.tsx';
import { ProcessingIndicator } from './components/ProcessingIndicator.tsx';
import { Header } from './components/Header.tsx';
import { PrivacyNotice } from './components/PrivacyNotice.tsx';
import { DownloadArea } from './components/DownloadArea.tsx';
import { RedactionPreview } from './components/RedactionPreview.tsx';

interface ProcessedFile {
    blob: Blob;
    fileName: string;
    transactions: Transaction[];
}

const App: React.FC = () => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStep, setProcessingStep] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [processedFile, setProcessedFile] = useState<ProcessedFile | null>(null);
    const [pagesForEdit, setPagesForEdit] = useState<RedactionPage[]>([]);
    const [redactedImages, setRedactedImages] = useState<string[]>([]);
    const [showRedactionPreview, setShowRedactionPreview] = useState(false);
    const [originalFileName, setOriginalFileName] = useState<string>('');


    useEffect(() => {
        // Set the worker source for pdf.js
        // For pdfjs-dist v5, we need to use a proper worker setup
        const workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url
        ).href;
        
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
        console.log('PDF.js version:', pdfjsLib.version);
        console.log('PDF.js worker configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);
    }, []);

    const convertPdfToImages = async (file: File, password?: string): Promise<RedactionPage[]> => {
        setProcessingStep('Reading PDF file...');
        const fileReader = new FileReader();

        return new Promise((resolve, reject) => {
            fileReader.onload = async (event) => {
                if (!event.target?.result) {
                    return reject(new Error("Failed to read file."));
                }

                try {
                    const typedarray = new Uint8Array(event.target.result as ArrayBuffer);
                    console.log('PDF file size:', typedarray.length, 'bytes');
                    
                    const pdfOptions: any = { 
                        data: typedarray,
                        verbosity: 0
                    };
                    
                    if (password) {
                        pdfOptions.password = password;
                    }
                    
                    console.log('Loading PDF document...');
                    const loadingTask = pdfjsLib.getDocument(pdfOptions);
                    
                    loadingTask.onProgress = (progress: any) => {
                        console.log('PDF loading progress:', progress.loaded, '/', progress.total);
                    };
                    
                    const pdf = await loadingTask.promise;
                    console.log('PDF loaded successfully. Pages:', pdf.numPages);
                    
                    const pages: RedactionPage[] = [];
                    const canvas = document.createElement("canvas");
                    const context = canvas.getContext("2d");

                    if (!context) {
                        return reject(new Error("Could not get canvas context."));
                    }

                    // Sensitive patterns to redact (robust)
                    const sensitivePatterns = [
                        /\b\d{4}[\s\-\*+]?\d{4}[\s\-\*+]?\d{4}[\s\-\*+]?\d{4}\b/,  // 16-digit card
                        /\b\d{10,18}\b/,  // Account numbers
                        /\b[A-Z]{4}0[A-Z0-9]{6}\b/i,  // IFSC
                        /\b[A-Z]{5}\d{4}[A-Z]\b/i,  // PAN
                    ];

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: 1.5 });
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        // First render the page without any masks
                        await page.render({ canvasContext: context, viewport, canvas }).promise;
                        const baseImage = canvas.toDataURL('image/jpeg');

                        // Now we will compute rectangles but NOT draw them yet; user can edit

                        // Get text content and compute positions per item
                        const textContent = await page.getTextContent();
                        let redactionCount = 0;
                        const rects: RedactionRect[] = [];

                        const vf = viewport.transform; // [a,b,c,d,e,f]

                        type PositionedItem = {
                            text: string;
                            x: number; // canvas/user space
                            yTop: number;
                            width: number;
                            height: number;
                        };

                        const positioned: PositionedItem[] = textContent.items.map((item: any) => {
                            const m = pdfjsLib.Util.transform(vf, item.transform);
                            const height = Math.hypot(m[2], m[3]);
                            const width = (item.width || Math.abs(m[0])) * (viewport.scale || 1);
                            return {
                                text: item.str || '',
                                x: m[4],
                                yTop: m[5],
                                width,
                                height,
                            };
                        });

                        // Group into lines by similar yTop (tolerance ~ 3px)
                        const tolerance = 3;
                        const lines: PositionedItem[][] = [];
                        positioned.forEach((it) => {
                            let placed = false;
                            for (const line of lines) {
                                const avgY = line.reduce((a, b) => a + b.yTop, 0) / line.length;
                                if (Math.abs(avgY - it.yTop) <= tolerance) {
                                    line.push(it);
                                    placed = true;
                                    break;
                                }
                            }
                            if (!placed) lines.push([it]);
                        });

                        // ============ ENHANCED AUTO-DETECTION PATTERNS ============
                        // Sort items in each line and search for sensitive patterns across concatenated text
                        
                        // Card numbers - more flexible for masked/partial cards
                        const cardRegex = /(?:\d[\s\-\*xX+]?){13,19}/g; // flexible digits with separators including x/X for masked
                        const maskedCardRegex = /(?:\*{4}|\d{4})[\s\-]?(?:\*{4}|\d{4})[\s\-]?(?:\*{4}|\d{4})[\s\-]?(?:\*{4}|\d{4})/gi; // explicit masked card format
                        const partialCardRegex = /(?:ending\s*(?:in\s*)?|last\s*(?:4|four)\s*(?:digits?)?\s*[:\s]?|x{4,}\s*)(\d{4})/gi; // "ending in 1234"
                        
                        // Account numbers - more patterns for international banks
                        const acctRegex = /\b\d{8,18}\b/g; // accounts (lowered min to 8 for some banks)
                        const ibanRegex = /\b[A-Z]{2}\d{2}[\sA-Z0-9]{11,30}\b/gi; // IBAN format
                        const sortCodeRegex = /\b\d{2}[\s\-]?\d{2}[\s\-]?\d{2}\b/g; // UK sort codes
                        const bsbRegex = /\b\d{3}[\s\-]?\d{3}\b/g; // Australian BSB
                        const routingRegex = /\b\d{9}\b/g; // US routing numbers (9 digits)
                        
                        // ID numbers
                        const ifscRegex = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi; // Indian IFSC
                        const panRegex = /\b[A-Z]{5}\d{4}[A-Z]\b/gi; // Indian PAN
                        const aadharRegex = /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g; // Indian Aadhaar
                        const sinRegex = /\b\d{3}[\s\-]?\d{3}[\s\-]?\d{3}\b/g; // Canadian SIN
                        const ssnRegex = /\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b/g; // US SSN
                        const ninRegex = /\b[A-Z]{2}\d{6}[A-Z]?\b/gi; // UK NIN
                        
                        // Postal codes - expanded
                        const postalScanRegex = /\b(?:\d{6}|\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d|[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/gi; // IN/US/CA/UK
                        const postalTestRegex = /\b(?:\d{6}|\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d|[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/i;
                        
                        // Phone numbers - international formats
                        const phoneRegex = /(?:\+?\d{1,3}[\s\-]?)?(?:\(?\d{2,4}\)?[\s\-]?)?\d{3,4}[\s\-]?\d{3,4}/g;
                        const phoneTestRegex = /(?:phone|mobile|cell|tel|contact|fax)[:\s]*(?:\+?\d[\d\s\-\(\)]{8,})/i;
                        
                        // Email addresses
                        const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi;
                        
                        // Enhanced label-value patterns
                        const labelValueRegex = /\b(Name|Full\s*Name|Account\s*Holder|Cardholder|Card\s*Holder|Billing\s*Name|Customer\s*Name|Customer\s*ID|Customer\s*No\.?|Customer\s*Number|Client\s*ID|Client\s*Name|Client\s*Number|CIF|CRN|URN|Member\s*ID|Member\s*No\.?|User\s*ID|Login\s*ID|Address|Billing\s*Address|Mailing\s*Address|Residence|Home\s*Address|Correspondence\s*Address|City|State|Province|Country|Postal\s*Code|ZIP\s*Code|ZIP|PIN|Pincode|Postcode|Date\s*of\s*Birth|DOB|Birth\s*Date|Phone|Mobile|Cell|Contact|Telephone|Tel|Email|E-mail|Email\s*ID|Email\s*Address|PAN|Aadhaar|SSN|SIN|NIN|Tax\s*ID|Passport|License|Licence|DL\s*No\.?|Branch|IFSC|MICR|Swift|BIC|Sort\s*Code|BSB|Routing)\b[:\s\-]*([A-Za-z0-9][A-Za-z0-9\s.@'\-\/,#]*)/gi;
                        
                        // Specific value after label patterns
                        const phoneAfterLabelRegex = /\b(?:phone|mobile|cell|tel|contact)[:\s\-]*(\+?[\d\s\-\(\)]{8,})/gi;
                        const emailAfterLabelRegex = /\b(?:email|e-mail)[:\s\-]*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi;
                        const dobAfterLabelRegex = /\b(?:DOB|Date\s*of\s*Birth|Birth\s*Date)[:\s\-]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4})/gi;
                        
                        const excludeBankWords = /(\bRBC\b|\bROYAL\b|\bBANK\b|\bVISA\b|\bMASTERCARD\b|\bCREDIT\b|\bCARD\b|\bSTATEMENT\b|\bION\b|\bSERVICE\b|\bCHARGE\b|\bPAYMENT\b|\bSAVINGS\b|\bCHEQUING\b|\bCHECKING\b|\bDEPOSIT\b|\bWITHDRAWAL\b|\bTRANSFER\b|\bBALANCE\b)/i;
                        const labelTokens = /(Card|Visa|Mastercard|Amex|American\s*Express|Account|Acc\.?|A\/C|Acct\.?|Client|Customer|CIF|CRN|IBAN|Account\s*No\.?|Acct\s*No\.?|ending|xxxx|masked|last\s*4)/i;
                        const tableHeaderTokens = /(Date|Posting\s*Date|Value\s*Date|Transaction\s*Date|Description|Narration|Particulars|Transaction|Type|Debit|Credit|Amount|Balance|Ref\.?|Reference|Chq\.?|Cheque|Check)/i;
                        const transactionTokens = /(UPI|IMPS|NEFT|RTGS|ACH|NACH|ATM|POS|PURCHASE|WITHDRAWAL|DEPOSIT|INTEREST|FEE|CHARGE|PAYMENT|TRANSFER|TXN|TRN|AUTH|POSTED|SETTLED|PENDING|CLEARED|REFUND|CASHBACK)/i;
                        const dateAnywhereRegex = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}|[A-Za-z]{3}\s+\d{1,2},?\s+\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/;
                        const moneyRegex = /(?:INR|Rs\.?|CAD|USD|EUR|GBP|AUD|NZD|\$|₹|£|€|¥)?\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:CR|DR)?/i;

                        // Helpers for address/name heuristics - expanded
                        const provinceAbbr = /(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|ACT|NSW|VIC|QLD|TAS|SA|WA)\b/; // CA/US/AU
                        const provinceNames = /(Ontario|Quebec|Alberta|British\s*Columbia|Manitoba|Saskatchewan|Nova\s*Scotia|New\s*Brunswick|Prince\s*Edward\s*Island|Newfoundland|Labrador|Yukon|Nunavut|Northwest\s*Territories|Maharashtra|Delhi|Karnataka|Tamil\s*Nadu|Gujarat|Rajasthan|Kerala|West\s*Bengal|Punjab|Haryana|Uttar\s*Pradesh|Madhya\s*Pradesh|Bihar|Odisha|Telangana|Andhra\s*Pradesh)/i;
                        const addressTokens = /(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Court|Ct\.?|Suite|Ste\.?|Apt\.?|Apartment|Unit|Flat|Floor|Block|Building|Bldg\.?|Tower|Sector|Colony|Nagar|Marg|Path|Way|Place|Pl\.?|Circle|Cir\.?|Highway|Hwy\.?|Close|Crescent|Cres\.?|Terrace|#\s*\d+)/i;
                        const countryTokens = /(India|Canada|United\s*States|USA|U\.S\.A\.|United\s*Kingdom|UK|U\.K\.|Australia|New\s*Zealand|Singapore|Hong\s*Kong|UAE|Dubai)/i;
                        
                        // More specific name patterns
                        const isUppercaseNameLine = (txt: string) => {
                            // Two or more consecutive uppercase words (len>=2), excluding bank words
                            const nameLike = /(?!RBC|ROYAL|BANK|VISA|MASTERCARD|CREDIT|CARD|STATEMENT|ION|SUMMARY|BALANCE|TOTAL|AMOUNT|DATE|DESCRIPTION)\b[A-Z][A-Z'\-]{1,}(?:\s+(?!RBC|ROYAL|BANK|VISA|MASTERCARD|CREDIT|CARD|STATEMENT|ION|SUMMARY|BALANCE|TOTAL|AMOUNT|DATE|DESCRIPTION)[A-Z][A-Z'\-]{1,})+/g;
                            return nameLike.test(txt);
                        };
                        
                        // Mixed case name pattern (e.g., "John Smith" or "Mary-Jane O'Connor")
                        const isMixedCaseNameLine = (txt: string) => {
                            const nameLike = /\b[A-Z][a-z]+(?:[\s\-'][A-Z]?[a-z]+)+\b/g;
                            const matches = txt.match(nameLike);
                            if (!matches) return false;
                            // Filter out obvious non-names
                            return matches.some(m => !excludeBankWords.test(m) && m.length > 4);
                        };

                        lines.forEach((line, lineIdx) => {
                            line.sort((a, b) => a.x - b.x);
                            // Build line text and char map
                            let lineText = '';
                            const ranges: { start: number; end: number; item: PositionedItem }[] = [];
                            let cursor = 0;
                            for (let idx = 0; idx < line.length; idx++) {
                                const cur = line[idx];
                                const prev = line[idx - 1];
                                // Insert space if gap between items is notable
                                if (prev) {
                                    const gap = cur.x - (prev.x + prev.width);
                                    if (gap > Math.max(2, prev.height * 0.25)) {
                                        lineText += ' ';
                                        cursor += 1;
                                    }
                                }
                                const start = cursor;
                                lineText += cur.text;
                                cursor += cur.text.length;
                                const end = cursor;
                                ranges.push({ start, end, item: cur });
                            }

                            // Helper to cover a start..end character range (union of items)
                            const coverRange = (startIdx: number, endIdx: number) => {
                                const covered = ranges.filter(r => r.end > startIdx && r.start < endIdx);
                                if (covered.length === 0) return false;
                                const minX = Math.min(...covered.map(c => c.item.x));
                                const maxX = Math.max(...covered.map(c => c.item.x + c.item.width));
                                const maxH = Math.max(...covered.map(c => c.item.height));
                                const yTop = covered[0].item.yTop;
                                const yCanvas = yTop - maxH;
                                const pad = 2;
                                rects.push({
                                    id: `${i}-${lineIdx}-${startIdx}-${endIdx}-${rects.length}`,
                                    x: minX - pad,
                                    y: yCanvas - pad,
                                    width: (maxX - minX) + pad * 2,
                                    height: maxH + pad * 2,
                                    source: 'auto'
                                });
                                redactionCount++;
                                return true;
                            };

                            // Heuristic: redact header block lines containing name/address/location near top region
                            const minX = Math.min(...line.map(i => i.x));
                            const maxX = Math.max(...line.map(i => i.x + i.width));
                            const maxH = Math.max(...line.map(i => i.height));
                            const yTop = line[0]?.yTop ?? 0;
                            const yCanvas = yTop - maxH;
                            const topRegion = yCanvas < viewport.height * 0.30; // expanded to top 30% of page
                            const notBankHeader = !excludeBankWords.test(lineText);
                            const looksLikeTxn = dateAnywhereRegex.test(lineText) && (tableHeaderTokens.test(lineText) || transactionTokens.test(lineText) || moneyRegex.test(lineText));
                            const hasLabel = labelTokens.test(lineText);
                            const looksLikeAddress = (
                                isUppercaseNameLine(lineText) ||
                                isMixedCaseNameLine(lineText) ||
                                addressTokens.test(lineText) ||
                                provinceAbbr.test(lineText) ||
                                provinceNames.test(lineText) ||
                                countryTokens.test(lineText) ||
                                postalTestRegex.test(lineText) ||
                                // Additional address indicators
                                /\b\d{1,5}\s+[A-Za-z]/i.test(lineText) || // Street number + name
                                /\b(P\.?O\.?\s*Box|Post\s*Office\s*Box)\b/i.test(lineText) // PO Box
                            );
                            if (topRegion && notBankHeader && looksLikeAddress && !looksLikeTxn && lineText.trim().length > 1) {
                                // Cover entire line range
                                coverRange(0, lineText.length);
                            }

                            let cardFoundOnLine = false;

                            // Primary patterns with gating to avoid transaction rows
                            // 1) Label-value pairs (safe anywhere)
                            labelValueRegex.lastIndex = 0;
                            {
                                let m: RegExpExecArray | null;
                                while ((m = labelValueRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }

                            // 2) Postal codes: only near top region (addresses)
                            if (topRegion && postalTestRegex.test(lineText)) {
                                postalScanRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = postalScanRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }

                            // 3) Card numbers: only in top region or with labels, and not on likely transaction lines
                            if ((topRegion || hasLabel) && !looksLikeTxn) {
                                // Standard card regex
                                cardRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = cardRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                    cardFoundOnLine = true;
                                }
                                // Masked card format (****1234 or similar)
                                maskedCardRegex.lastIndex = 0;
                                while ((m = maskedCardRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                    cardFoundOnLine = true;
                                }
                                // Partial card ("ending in 1234")
                                partialCardRegex.lastIndex = 0;
                                while ((m = partialCardRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                    cardFoundOnLine = true;
                                }
                            }

                            // 4) Account numbers: only in top region or with labels, and not on likely transaction lines
                            if ((topRegion || hasLabel) && !looksLikeTxn) {
                                acctRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = acctRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                                // IBAN
                                ibanRegex.lastIndex = 0;
                                while ((m = ibanRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }

                            // 5) IFSC/PAN/Aadhaar: only in top region or if explicitly present, and not on likely transaction lines
                            if ((topRegion || /IFSC/i.test(lineText)) && !looksLikeTxn) {
                                ifscRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = ifscRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            if ((topRegion || /\bPAN\b/i.test(lineText)) && !looksLikeTxn) {
                                panRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = panRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            if ((topRegion || /\bAadhaar\b/i.test(lineText)) && !looksLikeTxn) {
                                aadharRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = aadharRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            
                            // 6) SSN/SIN/NIN: only with explicit labels
                            if (/\b(SSN|Social\s*Security|SIN|Social\s*Insurance|NIN|National\s*Insurance)\b/i.test(lineText) && !looksLikeTxn) {
                                ssnRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = ssnRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                                sinRegex.lastIndex = 0;
                                while ((m = sinRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                                ninRegex.lastIndex = 0;
                                while ((m = ninRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            
                            // 7) Email addresses: redact anywhere they appear in header region
                            if (topRegion) {
                                emailRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = emailRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            // Email after label anywhere
                            emailAfterLabelRegex.lastIndex = 0;
                            {
                                let m: RegExpExecArray | null;
                                while ((m = emailAfterLabelRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            
                            // 8) Phone numbers: with labels or in header
                            if (topRegion || phoneTestRegex.test(lineText)) {
                                phoneAfterLabelRegex.lastIndex = 0;
                                let m: RegExpExecArray | null;
                                while ((m = phoneAfterLabelRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }
                            
                            // 9) Date of birth after label
                            dobAfterLabelRegex.lastIndex = 0;
                            {
                                let m: RegExpExecArray | null;
                                while ((m = dobAfterLabelRegex.exec(lineText)) !== null) {
                                    coverRange(m.index, m.index + m[0].length);
                                }
                            }

                            // If a card number was found, also redact likely NAME tokens (UPPERCASE words) on same line,
                            // excluding common bank words to avoid over-redaction.
                            if (cardFoundOnLine) {
                                const nameLike = /\b(?!RBC|ROYAL|BANK|VISA|MASTERCARD|CREDIT|CARD|STATEMENT|ION|SUMMARY|BALANCE|TOTAL)[A-Z][A-Z'\-]{1,}(?:\s+(?!RBC|ROYAL|BANK|VISA|MASTERCARD|CREDIT|CARD|STATEMENT|ION|SUMMARY|BALANCE|TOTAL)[A-Z][A-Z'\-]{1,})+/g;
                                let nm: RegExpExecArray | null;
                                while ((nm = nameLike.exec(lineText)) !== null) {
                                    // Skip if the token clearly contains excluded words
                                    if (excludeBankWords.test(nm[0])) continue;
                                    coverRange(nm.index, nm.index + nm[0].length);
                                }
                            }
                            
                            // 10) Mixed case names in header region (e.g., "John Smith")
                            if (topRegion && notBankHeader && !looksLikeTxn && isMixedCaseNameLine(lineText)) {
                                const nameLike = /\b[A-Z][a-z]+(?:[\s\-'][A-Z]?[a-z]+)+\b/g;
                                let nm: RegExpExecArray | null;
                                while ((nm = nameLike.exec(lineText)) !== null) {
                                    if (!excludeBankWords.test(nm[0]) && nm[0].length > 4) {
                                        coverRange(nm.index, nm.index + nm[0].length);
                                    }
                                }
                            }
                        });

                        console.log(`✅ Page ${i}: Redacted ${redactionCount} items`);
                        
                        pages.push({ baseImage, rects });
                    }
                    
                    canvas.remove();
                    resolve(pages);

                } catch (err: any) {
                    console.error("Error processing PDF:", err);
                    console.error("Error details:", {
                        message: err?.message,
                        name: err?.name,
                        code: err?.code,
                        stack: err?.stack,
                        toString: err?.toString?.()
                    });
                    
                    // Check if it's a password error
                    if (err?.name === 'PasswordException' || err?.code === 1) {
                        reject(new Error("PDF_PASSWORD_REQUIRED"));
                    } else if (err?.name === 'InvalidPDFException') {
                        reject(new Error("Invalid PDF file. Please ensure the file is a valid PDF document."));
                    } else if (err?.name === 'MissingPDFException') {
                        reject(new Error("PDF file appears to be empty or corrupted."));
                    } else {
                        const errorMsg = err?.message || err?.name || 'Unknown error';
                        reject(new Error(`Could not process the PDF: ${errorMsg}`));
                    }
                }
            };
            fileReader.onerror = () => reject(new Error("Error reading file."));
            fileReader.readAsArrayBuffer(file);
        });
    };
    
    const generateExcel = (data: Transaction[], fileName: string): ProcessedFile => {
        setProcessingStep('Creating Excel file...');
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
        
        // Auto-fit columns
        const cols = Object.keys(data[0] || {});
        if (cols.length > 0) {
            const colWidths = cols.map(col => ({
                wch: Math.max(...data.map(item => item[col as keyof Transaction]?.toString().length ?? 0), col.length) + 2
            }));
            worksheet['!cols'] = colWidths;
        }
        
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const finalFileName = `${fileName.replace(/\.pdf$/i, '')}_statement.xlsx`;
        
        return { blob, fileName: finalFileName, transactions: data };
    };

    const handleFileSelect = useCallback(async (file: File) => {
        setIsProcessing(true);
        setError(null);
        setProcessedFile(null);
        setShowRedactionPreview(false);
        setProcessingStep('Starting conversion...');

        try {
            let pages: RedactionPage[] = [];
            try {
                pages = await convertPdfToImages(file);
            } catch (err: any) {
                // If password is required, prompt user
                if (err.message === "PDF_PASSWORD_REQUIRED") {
                    const password = prompt("This PDF is password-protected. Please enter the password:");
                    if (password === null) {
                        throw new Error("Password required but not provided.");
                    }
                    pages = await convertPdfToImages(file, password);
                } else {
                    throw err;
                }
            }

            // Show redaction editor (images plus rectangles to edit)
            setPagesForEdit(pages);
            setOriginalFileName(file.name);
            setShowRedactionPreview(true);
            setIsProcessing(false);

        } catch (err: any) {
            setError(err.message || 'An unknown error occurred.');
            setIsProcessing(false);
            setProcessingStep('');
        }
    }, []);

    const rasterizeWithRects = async (pages: RedactionPage[]): Promise<string[]> => {
        // Draw rectangles on top of base images to produce final redacted images
        const out: string[] = [];
        for (const p of pages) {
            const img = new Image();
            await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error('Failed to load base image'));
                img.src = p.baseImage;
            });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas not supported');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            ctx.fillStyle = 'black';
            for (const r of p.rects) {
                ctx.fillRect(r.x, r.y, r.width, r.height);
            }
            out.push(canvas.toDataURL('image/jpeg'));
        }
        return out;
    };

    const handleRedactionProceed = useCallback(async () => {
        setIsProcessing(true);
        setShowRedactionPreview(false);
        setProcessingStep('Analyzing statement with AI...');

        try {
            // Bake current rects into images
            const finalImages = await rasterizeWithRects(pagesForEdit);
            setRedactedImages(finalImages);
            const transactions = await extractTransactionsFromImages(finalImages);

            if (transactions.length === 0) {
                throw new Error("No transactions could be extracted. Please check the PDF content.");
            }

            const fileData = generateExcel(transactions, originalFileName);
            setProcessedFile(fileData);

        } catch (err: any) {
            setError(err.message || 'An unknown error occurred.');
        } finally {
            setIsProcessing(false);
            setProcessingStep('');
        }
    }, [pagesForEdit, originalFileName]);

    const handleRedactionCancel = useCallback(() => {
        setShowRedactionPreview(false);
        setRedactedImages([]);
        setPagesForEdit([]);
        setOriginalFileName('');
    }, []);

    const handleReset = useCallback(() => {
        setError(null);
        setProcessedFile(null);
    }, []);
    
    const renderContent = () => {
        if (isProcessing) {
            return <ProcessingIndicator step={processingStep} />;
        }
        if (showRedactionPreview) {
            // RedactionPreview now renders as fullscreen overlay
            return <RedactionPreview 
                pages={pagesForEdit}
                onUpdate={setPagesForEdit}
                onProceed={handleRedactionProceed}
                onCancel={handleRedactionCancel}
            />;
        }
        if (processedFile) {
            return <DownloadArea fileBlob={processedFile.blob} fileName={processedFile.fileName} transactions={processedFile.transactions} onReset={handleReset} />;
        }
        return <FileUpload onFileSelect={handleFileSelect} disabled={isProcessing} />;
    };

    // When showing redaction preview, render it outside the normal layout (fullscreen)
    if (showRedactionPreview) {
        return (
            <RedactionPreview 
                pages={pagesForEdit}
                onUpdate={setPagesForEdit}
                onProceed={handleRedactionProceed}
                onCancel={handleRedactionCancel}
            />
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 to-gray-100">
            {/* Main Content */}
            <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
                <div className="w-full max-w-xl mx-auto">
                    <Header />
                    <div className="mt-6 sm:mt-8">
                        {isProcessing ? (
                            <ProcessingIndicator step={processingStep} />
                        ) : processedFile ? (
                            <DownloadArea 
                                fileBlob={processedFile.blob} 
                                fileName={processedFile.fileName} 
                                transactions={processedFile.transactions} 
                                onReset={handleReset} 
                            />
                        ) : (
                            <FileUpload onFileSelect={handleFileSelect} disabled={isProcessing} />
                        )}
                    </div>
                    {error && !processedFile && (
                        <div className="mt-4 text-center p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl">
                            <p><span className="font-semibold">Error:</span> {error}</p>
                        </div>
                    )}
                    <PrivacyNotice />
                </div>
            </main>
            
            {/* Footer */}
            <footer className="text-center py-4 text-gray-500 text-sm">
                <p>&copy; {new Date().getFullYear()} Secure Statement Converter</p>
            </footer>
        </div>
    );
};

export default App;