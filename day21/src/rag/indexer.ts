import fs from 'fs/promises';
import path from 'path';
import type { Chunk, IndexFile, RagConfig } from './types.js';
import { type ChunkStrategy } from './types.js';
import { fixedChunk, structuralChunk } from './chunker.js';
import { Embedder } from './embedder.js';

export function getTitleFromPath(filePath: string, sourcePath: string): string {
  const rel = path.relative(sourcePath, filePath);
  const parts = rel.split(path.sep);
  // Если файл сразу в корне sourcePath — возвращаем имя файла
  if (parts.length === 1) return parts[0];
  // Иначе — первая папка
  return parts[0];
}

export function getRelativePath(filePath: string, sourcePath: string): string {
  return path.relative(sourcePath, filePath);
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMdFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

async function buildChunksForFile(
  filePath: string,
  sourcePath: string,
  strategy: ChunkStrategy,
  config: RagConfig,
  embedder: Embedder,
): Promise<Chunk[]> {
  const text = await fs.readFile(filePath, 'utf-8');
  const title = getTitleFromPath(filePath, sourcePath);
  const relPath = getRelativePath(filePath, sourcePath);
  const file = path.basename(filePath);

  const MAX_EMBED_CHARS = 2000;

  const rawChunks: Array<{ text: string; section: string }> =
    strategy === 'fixed'
      ? fixedChunk(text, config.chunkSize, config.chunkOverlap).map((t) => ({ text: t, section: '' }))
      : structuralChunk(text).flatMap((c) =>
          c.text.length <= MAX_EMBED_CHARS
            ? [{ text: c.text, section: c.heading }]
            : fixedChunk(c.text, config.chunkSize, config.chunkOverlap).map((t) => ({ text: t, section: c.heading }))
        );

  const chunks: Chunk[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const { text: chunkText, section } = rawChunks[i];
    const embedding = await embedder.embed(chunkText);
    chunks.push({
      chunk_id: `${relPath}_${i}`,
      source: filePath,
      file,
      title,
      section,
      strategy,
      text: chunkText,
      embedding,
    });
  }
  return chunks;
}

export async function buildIndex(strategy: ChunkStrategy, config: RagConfig): Promise<IndexFile> {
  const embedder = new Embedder(config.ollamaUrl, config.embeddingModel);
  const files = await collectMdFiles(config.sourcePath);
  const allChunks: Chunk[] = [];

  for (const file of files) {
    const chunks = await buildChunksForFile(file, config.sourcePath, strategy, config, embedder);
    allChunks.push(...chunks);
  }

  return {
    meta: {
      created_at: new Date().toISOString(),
      model: config.embeddingModel,
      strategy,
      total_chunks: allChunks.length,
    },
    chunks: allChunks,
  };
}

export async function saveIndex(index: IndexFile, outputPath: string, strategy: ChunkStrategy): Promise<void> {
  await fs.mkdir(outputPath, { recursive: true });
  const filePath = path.join(outputPath, `index-${strategy}.json`);
  await fs.writeFile(filePath, JSON.stringify(index, null, 2), 'utf-8');
}

export async function loadIndex(outputPath: string, strategy: ChunkStrategy): Promise<IndexFile | null> {
  const filePath = path.join(outputPath, `index-${strategy}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as IndexFile;
  } catch {
    return null;
  }
}
