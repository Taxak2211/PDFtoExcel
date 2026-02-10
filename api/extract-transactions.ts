import { extractTransactionsFromBase64Images } from '../server/extractTransactions';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'Server is missing GEMINI_API_KEY. Set it in Vercel Project Settings → Environment Variables (no VITE_ prefix).',
    });
  }

  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  const images = body?.images;

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Body must include { images: string[] }' });
  }

  // Keep payloads bounded; base64 images can get huge.
  if (images.length > 30) {
    return res.status(400).json({ error: 'Too many images (max 30 pages).' });
  }

  try {
    const transactions = await extractTransactionsFromBase64Images({ images, apiKey });
    return res.status(200).json({ transactions });
  } catch (err: any) {
    const message = err?.message ? String(err.message) : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
