import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { extractTransactionsFromBase64Images } from './server/extractTransactions.js';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'local-api-extract-transactions',
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              try {
                if (req.method !== 'POST' || req.url !== '/api/extract-transactions') {
                  return next();
                }

                const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
                if (!apiKey) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Missing GEMINI_API_KEY in .env.local' }));
                  return;
                }

                const chunks: Buffer[] = [];
                req.on('data', (c) => chunks.push(Buffer.from(c)));
                req.on('end', async () => {
                  let body: any;
                  try {
                    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                  } catch {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
                    return;
                  }

                  const images = body?.images;
                  if (!Array.isArray(images) || images.length === 0) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Body must include { images: string[] }' }));
                    return;
                  }

                  try {
                    const transactions = await extractTransactionsFromBase64Images({
                      images,
                      apiKey,
                    });
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ transactions }));
                  } catch (err: any) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: err?.message ? String(err.message) : 'Unknown error' }));
                  }
                });
              } catch (err) {
                return next(err);
              }
            });
          },
        },
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      worker: {
        format: 'es'
      },
      optimizeDeps: {
        include: ['pdfjs-dist']
      }
    };
});
