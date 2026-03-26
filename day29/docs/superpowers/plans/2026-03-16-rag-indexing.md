# RAG Индексация документов — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в CLI-агент пайплайн RAG-индексации: нарезка MD-документов двумя стратегиями, генерация эмбеддингов через Ollama, сохранение JSON-индекса и поиск по команде `/rag`.

**Architecture:** Изолированный модуль `src/rag/` с координатором `RagManager`. Индекс хранится в двух JSON-файлах (`rag-data/index-fixed.json`, `rag-data/index-structural.json`). Эмбеддинги генерируются через локальный Ollama HTTP API.

**Tech Stack:** TypeScript, Node.js fs/path, Ollama HTTP API (nomic-embed-text), Vitest (тесты)

---

## Chunk 1: Vitest + Types + Chunker

### Task 1: Установить Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Установить vitest как dev-зависимость**

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

- [ ] **Step 2: Добавить скрипт test в package.json**

В `package.json` в раздел `"scripts"` добавить:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Создать `vitest.config.ts`** (обязателен для ESM-проекта)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Проверить что vitest работает**

```bash
npm test
```
Ожидаемый вывод: `No test files found` или `0 passed` — без ошибок запуска.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for testing"
```

---

### Task 2: Типы RAG-модуля

**Files:**
- Create: `src/rag/types.ts`

- [ ] **Step 1: Написать тест на типы**

Создать `tests/rag/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { Chunk, IndexFile, SearchResult, RagConfig } from '../../src/rag/types.js';

describe('RAG types', () => {
  it('Chunk should have required fields', () => {
    const chunk: Chunk = {
      chunk_id: 'path/to/file_0',
      source: '/absolute/path/to/file.md',
      file: 'file.md',
      title: 'Head First. Архитектура ПО',
      section: 'Микроядерная архитектура',
      strategy: 'fixed',
      text: 'Some text content',
      embedding: [0.1, 0.2, 0.3],
    };
    expect(chunk.chunk_id).toBe('path/to/file_0');
    expect(chunk.strategy).toBe('fixed');
  });

  it('RagConfig should have required fields', () => {
    const config: RagConfig = {
      sourcePath: 'for_rag/Архитектура',
      outputPath: 'rag-data',
      embeddingModel: 'nomic-embed-text',
      ollamaUrl: 'http://localhost:11434',
      topK: 3,
      chunkSize: 500,
      chunkOverlap: 100,
    };
    expect(config.topK).toBe(3);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что он падает**

```bash
npm test
```
Ожидаемый вывод: ошибка `Cannot find module '../../src/rag/types.js'`

- [ ] **Step 3: Создать `src/rag/types.ts`**

```typescript
export type ChunkStrategy = 'fixed' | 'structural';

export interface Chunk {
  chunk_id: string;       // "{relative_path}_{index}"
  source: string;         // абсолютный путь к файлу
  file: string;           // имя файла
  title: string;          // название книги (папка первого уровня)
  section: string;        // ближайший заголовок ## / ###; "" если нет
  strategy: ChunkStrategy;
  text: string;
  embedding: number[];
}

export interface IndexMeta {
  created_at: string;
  model: string;
  strategy: ChunkStrategy;
  total_chunks: number;
}

export interface IndexFile {
  meta: IndexMeta;
  chunks: Chunk[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;  // косинусное сходство [0, 1]
}

export interface RagConfig {
  sourcePath: string;      // путь к for_rag/Архитектура
  outputPath: string;      // путь к rag-data/
  embeddingModel: string;  // "nomic-embed-text"
  ollamaUrl: string;       // "http://localhost:11434"
  topK: number;            // кол-во результатов поиска
  chunkSize: number;       // для fixed: 500
  chunkOverlap: number;    // для fixed: 100
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
npm test tests/rag/types.test.ts
```
Ожидаемый вывод: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add src/rag/types.ts tests/rag/types.test.ts
git commit -m "feat: add RAG types"
```

---

### Task 3: Chunker — два алгоритма нарезки

**Files:**
- Create: `src/rag/chunker.ts`
- Test: `tests/rag/chunker.test.ts`

- [ ] **Step 1: Написать тесты для chunker**

Создать `tests/rag/chunker.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { fixedChunk, structuralChunk } from '../../src/rag/chunker.js';

describe('fixedChunk', () => {
  it('разбивает текст на чанки заданного размера', () => {
    const text = 'a'.repeat(1200);
    const chunks = fixedChunk(text, 500, 100);
    // При тексте 1200 символов, size=500, overlap=100:
    // чанк 0: 0-499
    // чанк 1: 400-899
    // чанк 2: 800-1199
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(500);
    expect(chunks[1].length).toBe(500);
  });

  it('возвращает один чанк если текст короче size', () => {
    const text = 'короткий текст';
    const chunks = fixedChunk(text, 500, 100);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
  });

  it('последний чанк содержит остаток текста', () => {
    const text = 'a'.repeat(600);
    const chunks = fixedChunk(text, 500, 100);
    expect(chunks.length).toBe(2);
    expect(chunks[1]).toBe('a'.repeat(200)); // 600 - 400 = 200
  });
});

describe('structuralChunk', () => {
  it('разбивает markdown по заголовкам ## и ###', () => {
    const text = `# Заголовок H1

Вводный текст.

## Раздел 1

Содержимое раздела 1.

## Раздел 2

Содержимое раздела 2.

### Подраздел 2.1

Содержимое подраздела.`;

    const chunks = structuralChunk(text);
    expect(chunks.length).toBe(3);
    expect(chunks[0].heading).toBe('Раздел 1');
    expect(chunks[1].heading).toBe('Раздел 2');
    expect(chunks[2].heading).toBe('Подраздел 2.1');
  });

  it('возвращает один чанк если нет заголовков ## или ###', () => {
    const text = '# Только H1\n\nТекст без подзаголовков.';
    const chunks = structuralChunk(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading).toBe('');
    expect(chunks[0].text).toBe(text);
  });

  it('чанк включает текст после заголовка до следующего', () => {
    const text = `## Первый\n\nТекст первого.\n\n## Второй\n\nТекст второго.`;
    const chunks = structuralChunk(text);
    expect(chunks[0].text).toContain('Текст первого.');
    expect(chunks[0].text).not.toContain('Текст второго.');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npm test tests/rag/chunker.test.ts
```
Ожидаемый вывод: ошибка `Cannot find module '../../src/rag/chunker.js'`

- [ ] **Step 3: Создать `src/rag/chunker.ts`**

```typescript
/**
 * Стратегия 1: Фиксированный чанкинг со скользящим окном.
 * Возвращает массив строк-чанков.
 */
export function fixedChunk(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += size - overlap;
  }

  return chunks;
}

export interface StructuralChunk {
  heading: string;  // текст заголовка без # символов; "" если нет заголовка
  text: string;     // полный текст секции включая заголовок
}

/**
 * Стратегия 2: Структурный чанкинг по заголовкам ## и ###.
 * Fallback: если нет заголовков — весь текст как один чанк с heading="".
 */
export function structuralChunk(text: string): StructuralChunk[] {
  const lines = text.split('\n');
  const chunks: StructuralChunk[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let hasHeadings = false;

  for (const line of lines) {
    const match = line.match(/^#{2,3}\s+(.+)/);
    if (match) {
      hasHeadings = true;
      if (currentLines.length > 0) {
        const chunkText = currentLines.join('\n').trim();
        if (chunkText) {
          chunks.push({ heading: currentHeading, text: chunkText });
        }
      }
      currentHeading = match[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Последняя секция
  if (currentLines.length > 0) {
    const chunkText = currentLines.join('\n').trim();
    if (chunkText) {
      chunks.push({ heading: currentHeading, text: chunkText });
    }
  }

  // Fallback: нет заголовков
  if (!hasHeadings) {
    return [{ heading: '', text: text }];
  }

  return chunks;
}
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test tests/rag/chunker.test.ts
```
Ожидаемый вывод: `6 passed` (3 для fixedChunk + 3 для structuralChunk)

- [ ] **Step 5: Commit**

```bash
git add src/rag/chunker.ts tests/rag/chunker.test.ts
git commit -m "feat: add RAG chunker (fixed + structural strategies)"
```

---

## Chunk 2: Embedder + Searcher + Indexer

### Task 4: Embedder — HTTP-клиент к Ollama

**Files:**
- Create: `src/rag/embedder.ts`
- Test: `tests/rag/embedder.test.ts`

- [ ] **Step 1: Написать тест на embedder**

Создать `tests/rag/embedder.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { Embedder } from '../../src/rag/embedder.js';

describe('Embedder', () => {
  it('возвращает массив чисел для текста', async () => {
    // Мокаем fetch чтобы не требовать реальный Ollama
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    } as Response);

    const embedder = new Embedder('http://localhost:11434', 'nomic-embed-text');
    const vector = await embedder.embed('тестовый текст');

    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
    expect(typeof vector[0]).toBe('number');
  });

  it('бросает ошибку при недоступном Ollama', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const embedder = new Embedder('http://localhost:11434', 'nomic-embed-text');
    await expect(embedder.embed('текст')).rejects.toThrow('Ollama недоступен');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npm test tests/rag/embedder.test.ts
```
Ожидаемый вывод: ошибка `Cannot find module '../../src/rag/embedder.js'`

- [ ] **Step 3: Создать `src/rag/embedder.ts`**

Пробуем `/api/embed` (Ollama 0.5+), при 404 — fallback на `/api/embeddings` (старые версии):

```typescript
export class Embedder {
  constructor(
    private readonly ollamaUrl: string,
    private readonly model: string,
  ) {}

  async embed(text: string): Promise<number[]> {
    try {
      // Пробуем новый endpoint (Ollama 0.5+)
      let response = await fetch(`${this.ollamaUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      // Fallback на старый endpoint
      if (response.status === 404) {
        response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: text }),
        });
      }

      if (!response.ok) {
        throw new Error(`Ollama вернул ${response.status}. Убедитесь что модель загружена: ollama pull nomic-embed-text`);
      }

      const data = await response.json() as { embeddings?: number[][]; embedding?: number[] };
      return data.embeddings?.[0] ?? data.embedding ?? [];
    } catch (error) {
      if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
        throw new Error('Ollama недоступен. Запустите: ollama serve');
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test tests/rag/embedder.test.ts
```
Ожидаемый вывод: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add src/rag/embedder.ts tests/rag/embedder.test.ts
git commit -m "feat: add RAG embedder (Ollama HTTP client)"
```

---

### Task 5: Searcher — косинусное сходство

**Files:**
- Create: `src/rag/searcher.ts`
- Test: `tests/rag/searcher.test.ts`

- [ ] **Step 1: Написать тесты**

Создать `tests/rag/searcher.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, search } from '../../src/rag/searcher.js';
import type { Chunk } from '../../src/rag/types.js';

describe('cosineSimilarity', () => {
  it('возвращает 1 для одинаковых векторов', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('возвращает 0 для ортогональных векторов', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('возвращает значение от 0 до 1 для похожих векторов', () => {
    const score = cosineSimilarity([1, 2, 3], [1, 2, 4]);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('search', () => {
  const makeChunk = (text: string, embedding: number[]): Chunk => ({
    chunk_id: text,
    source: '/test.md',
    file: 'test.md',
    title: 'Test',
    section: '',
    strategy: 'fixed',
    text,
    embedding,
  });

  it('возвращает топ-K результатов отсортированных по score', () => {
    const chunks = [
      makeChunk('чанк А', [1, 0, 0]),
      makeChunk('чанк Б', [0, 1, 0]),
      makeChunk('чанк В', [0.9, 0.1, 0]),
    ];
    const query = [1, 0, 0];
    const results = search(query, chunks, 2);

    expect(results.length).toBe(2);
    expect(results[0].chunk.text).toBe('чанк А');
    expect(results[0].score).toBeCloseTo(1);
    expect(results[1].chunk.text).toBe('чанк В');
  });

  it('возвращает меньше K если чанков меньше', () => {
    const chunks = [makeChunk('один', [1, 0])];
    const results = search([1, 0], chunks, 5);
    expect(results.length).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npm test tests/rag/searcher.test.ts
```
Ожидаемый вывод: ошибка `Cannot find module '../../src/rag/searcher.js'`

- [ ] **Step 3: Создать `src/rag/searcher.ts`**

```typescript
import type { Chunk, SearchResult } from './types.js';

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function search(queryEmbedding: number[], chunks: Chunk[], topK: number): SearchResult[] {
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test tests/rag/searcher.test.ts
```
Ожидаемый вывод: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/rag/searcher.ts tests/rag/searcher.test.ts
git commit -m "feat: add RAG searcher (cosine similarity)"
```

---

### Task 6: Indexer — сборка и сохранение индекса

**Files:**
- Create: `src/rag/indexer.ts`
- Test: `tests/rag/indexer.test.ts`

Indexer отвечает за: рекурсивное чтение MD-файлов, нарезку двумя стратегиями, генерацию эмбеддингов, сохранение/загрузку JSON.

- [ ] **Step 1: Написать тесты**

Создать `tests/rag/indexer.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTitleFromPath, getRelativePath } from '../../src/rag/indexer.js';
import path from 'path';

describe('getTitleFromPath', () => {
  it('возвращает имя папки первого уровня под sourcePath', () => {
    const sourcePath = '/project/for_rag/Архитектура';
    const filePath = '/project/for_rag/Архитектура/Head First. Архитектура ПО/5. Стили.md';
    expect(getTitleFromPath(filePath, sourcePath)).toBe('Head First. Архитектура ПО');
  });

  it('возвращает имя файла для файлов в корне sourcePath', () => {
    const sourcePath = '/project/for_rag/Архитектура';
    const filePath = '/project/for_rag/Архитектура/00. Head First. Паттерны.md';
    expect(getTitleFromPath(filePath, sourcePath)).toBe('00. Head First. Паттерны.md');
  });
});

describe('getRelativePath', () => {
  it('возвращает путь относительно sourcePath', () => {
    const sourcePath = '/project/for_rag/Архитектура';
    const filePath = '/project/for_rag/Архитектура/Head First/5. Стили.md';
    const rel = getRelativePath(filePath, sourcePath);
    expect(rel).toBe('Head First/5. Стили.md');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npm test tests/rag/indexer.test.ts
```

- [ ] **Step 3: Создать `src/rag/indexer.ts`**

```typescript
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

  const rawChunks: Array<{ text: string; section: string }> =
    strategy === 'fixed'
      ? fixedChunk(text, config.chunkSize, config.chunkOverlap).map((t) => ({ text: t, section: '' }))
      : structuralChunk(text).map((c) => ({ text: c.text, section: c.heading }));

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
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test tests/rag/indexer.test.ts
```
Ожидаемый вывод: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add src/rag/indexer.ts tests/rag/indexer.test.ts
git commit -m "feat: add RAG indexer (build, save, load)"
```

---

## Chunk 3: RagManager + Chat.tsx интеграция

### Task 7: RagManager + index.ts

**Files:**
- Create: `src/rag/RagManager.ts`
- Create: `src/rag/index.ts`

- [ ] **Step 1: Написать тест на RagManager**

Создать `tests/rag/RagManager.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagManager } from '../../src/rag/RagManager.js';

// Мокаем indexer и embedder чтобы не требовать реальный Ollama и файловую систему
vi.mock('../../src/rag/indexer.js', () => ({
  buildIndex: vi.fn().mockResolvedValue({
    meta: { created_at: '', model: 'nomic-embed-text', strategy: 'fixed', total_chunks: 1 },
    chunks: [
      {
        chunk_id: 'test_0',
        source: '/test.md',
        file: 'test.md',
        title: 'Test',
        section: '',
        strategy: 'fixed',
        text: 'микроядерная архитектура',
        embedding: [1, 0, 0],
      },
    ],
  }),
  saveIndex: vi.fn().mockResolvedValue(undefined),
  loadIndex: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/rag/embedder.js', () => ({
  Embedder: vi.fn().mockImplementation(() => ({
    embed: vi.fn().mockResolvedValue([1, 0, 0]),
  })),
}));

describe('RagManager', () => {
  let manager: RagManager;

  beforeEach(() => {
    vi.clearAllMocks(); // сбрасываем счётчики вызовов между тестами
    manager = new RagManager({
      sourcePath: 'for_rag/Архитектура',
      outputPath: 'rag-data',
      embeddingModel: 'nomic-embed-text',
      ollamaUrl: 'http://localhost:11434',
      topK: 3,
      chunkSize: 500,
      chunkOverlap: 100,
    });
  });

  it('index() вызывает buildIndex для обеих стратегий', async () => {
    const { buildIndex, saveIndex } = await import('../../src/rag/indexer.js');
    await manager.index();
    expect(buildIndex).toHaveBeenCalledWith('fixed', expect.any(Object));
    expect(buildIndex).toHaveBeenCalledWith('structural', expect.any(Object));
    expect(saveIndex).toHaveBeenCalledTimes(2);
  });

  it('search() возвращает массив SearchResult', async () => {
    await manager.index();
    const results = await manager.search('микроядро', 'fixed');
    expect(Array.isArray(results)).toBe(true);
  });

  it('compare() возвращает результаты для обеих стратегий', async () => {
    await manager.index();
    const result = await manager.compare('микроядро');
    expect(result).toHaveProperty('fixed');
    expect(result).toHaveProperty('structural');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npm test tests/rag/RagManager.test.ts
```

- [ ] **Step 3: Создать `src/rag/RagManager.ts`**

```typescript
import type { RagConfig, SearchResult, ChunkStrategy, IndexFile } from './types.js';
import { buildIndex, saveIndex, loadIndex } from './indexer.js';
import { Embedder } from './embedder.js';
import { search } from './searcher.js';

export class RagManager {
  private indexes: Map<ChunkStrategy, IndexFile> = new Map();
  private embedder: Embedder;

  constructor(private readonly config: RagConfig) {
    this.embedder = new Embedder(config.ollamaUrl, config.embeddingModel);
  }

  async index(): Promise<void> {
    for (const strategy of ['fixed', 'structural'] as ChunkStrategy[]) {
      const index = await buildIndex(strategy, this.config);
      await saveIndex(index, this.config.outputPath, strategy);
      this.indexes.set(strategy, index);
    }
  }

  private async ensureIndex(strategy: ChunkStrategy): Promise<IndexFile> {
    if (!this.indexes.has(strategy)) {
      const loaded = await loadIndex(this.config.outputPath, strategy);
      if (!loaded) throw new Error(`Индекс не найден. Запустите /rag index`);
      this.indexes.set(strategy, loaded);
    }
    return this.indexes.get(strategy)!;
  }

  async search(
    query: string,
    strategy: ChunkStrategy = 'structural',
    topK?: number,
  ): Promise<SearchResult[]> {
    const index = await this.ensureIndex(strategy);
    const queryEmbedding = await this.embedder.embed(query);
    return search(queryEmbedding, index.chunks, topK ?? this.config.topK);
  }

  async compare(query: string): Promise<{ fixed: SearchResult[]; structural: SearchResult[] }> {
    const [fixed, structural] = await Promise.all([
      this.search(query, 'fixed'),
      this.search(query, 'structural'),
    ]);
    return { fixed, structural };
  }
}
```

- [ ] **Step 4: Создать `src/rag/index.ts`**

```typescript
export { RagManager } from './RagManager.js';
export type { Chunk, IndexFile, SearchResult, RagConfig, ChunkStrategy } from './types.js';
```

- [ ] **Step 5: Запустить тесты**

```bash
npm test tests/rag/RagManager.test.ts
```
Ожидаемый вывод: `3 passed`

- [ ] **Step 6: Запустить все тесты**

```bash
npm test
```
Ожидаемый вывод: все тесты `passed`

- [ ] **Step 7: Commit**

```bash
git add src/rag/RagManager.ts src/rag/index.ts tests/rag/RagManager.test.ts
git commit -m "feat: add RagManager coordinator"
```

---

### Task 8: Интеграция в Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx`

Паттерн: аналогично `InvariantManager` — инициализация через `useState`, обработчик команды в `handleCommand`.

- [ ] **Step 1: Добавить импорт RagManager в Chat.tsx**

В начало файла (после последнего import):
```typescript
import { RagManager } from '../rag/index.js';
import path from 'path';
```

- [ ] **Step 2: Инициализировать RagManager рядом с другими менеджерами (~строка 225)**

После `const [mcpManager] = useState(...)`:
```typescript
const [ragManager] = useState(() => new RagManager({
  sourcePath: path.resolve('for_rag/Архитектура'),
  outputPath: path.resolve('rag-data'),
  embeddingModel: 'nomic-embed-text',
  ollamaUrl: 'http://localhost:11434',
  topK: 3,
  chunkSize: 500,
  chunkOverlap: 100,
}));
```

- [ ] **Step 3: Добавить обработчик /rag в handleCommand**

Найти блок `// Invariants commands` (~строка 1240) и добавить перед ним:

```typescript
// RAG commands
if (trimmed.startsWith('/rag')) {
  const args = trimmed.slice(4).trim();

  if (args === 'index' || args === '') {
    if (args === 'index') {
      setNotification('⏳ Индексирую документы... (это займёт несколько минут)');
      try {
        await ragManager.index();
        setNotification('✅ Индекс построен. Используй /rag <запрос> для поиска.');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setNotification(`❌ ${msg}`);
      }
      return true;
    }
    setNotification(
      'RAG команды:\n' +
      '  /rag index             — индексировать документы\n' +
      '  /rag <запрос>          — поиск (structural)\n' +
      '  /rag <запрос> --fixed  — поиск (fixed)\n' +
      '  /rag compare <запрос>  — сравнить стратегии'
    );
    return true;
  }

  if (args.startsWith('compare ')) {
    const query = args.slice(8).trim();
    if (!query) {
      setNotification('Использование: /rag compare <запрос>');
      return true;
    }
    try {
      const { fixed, structural } = await ragManager.compare(query);
      const fmt = (results: typeof fixed) =>
        results.map((r, i) =>
          `${i + 1}. [${r.score.toFixed(2)}] ${r.chunk.title} / ${r.chunk.file}\n   ${r.chunk.text.slice(0, 150).replace(/\n/g, ' ')}...`
        ).join('\n\n');

      setNotification(
        `🔍 Сравнение стратегий: "${query}"\n\n` +
        `── STRUCTURAL ──────────────────────\n${fmt(structural)}\n\n` +
        `── FIXED ───────────────────────────\n${fmt(fixed)}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setNotification(`❌ ${msg}`);
    }
    return true;
  }

  // /rag <query> [--fixed]
  const useFixed = args.endsWith('--fixed');
  const query = useFixed ? args.slice(0, -7).trim() : args;
  const strategy = useFixed ? 'fixed' : 'structural';

  if (!query) {
    setNotification('Использование: /rag <запрос>');
    return true;
  }

  try {
    const results = await ragManager.search(query, strategy);
    const output = results
      .map((r, i) =>
        `${i + 1}. [${r.score.toFixed(2)}] ${r.chunk.title} / ${r.chunk.file}\n` +
        (r.chunk.section ? `   section: "${r.chunk.section}"\n` : '') +
        `   "${r.chunk.text.slice(0, 200).replace(/\n/g, ' ')}..."`
      )
      .join('\n\n');

    setNotification(`🔍 RAG поиск (${strategy}): "${query}"\n\n${output}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setNotification(msg.includes('Ollama') ? `❌ ${msg}` : `❌ ${msg}`);
  }
  return true;
}
```

- [ ] **Step 4: Добавить /rag в /help**

В блоке `/help` после раздела `📡 MCP:` добавить:
```
🔍 RAG:
  /rag index             — индексировать документы
  /rag <запрос>          — поиск по базе знаний
  /rag <запрос> --fixed  — поиск (fixed стратегия)
  /rag compare <запрос>  — сравнить две стратегии
```

- [ ] **Step 5: Собрать проект**

```bash
npm run build
```
Ожидаемый вывод: сборка без ошибок TypeScript.

- [ ] **Step 6: Запустить полный тест-сьют**

```bash
npm test
```
Ожидаемый вывод: все тесты `passed`

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat.tsx src/rag/
git commit -m "feat: integrate RAG into CLI agent (/rag command)"
```

---

### Task 9: Ручная проверка (smoke test)

Проверить что весь пайплайн работает end-to-end с реальным Ollama.

- [ ] **Step 1: Убедиться что Ollama запущен**

```bash
ollama serve &
ollama pull nomic-embed-text
```

- [ ] **Step 2: Запустить агента**

```bash
npm start
```

- [ ] **Step 3: Запустить индексацию**

```
/rag index
```
Ожидаемый вывод: `⏳ Индексирую документы...` → через несколько минут `✅ Индекс построен`

- [ ] **Step 4: Проверить что файлы индекса созданы**

В другом терминале:
```bash
ls rag-data/
# Ожидаемый вывод: index-fixed.json  index-structural.json
```

- [ ] **Step 5: Выполнить поиск**

```
/rag что такое микроядерная архитектура
```
Ожидаемый вывод: топ-3 результата с названиями файлов и score > 0.5

- [ ] **Step 6: Выполнить сравнение стратегий**

```
/rag compare event-driven архитектура
```
Ожидаемый вывод: блоки STRUCTURAL и FIXED с разными результатами

- [ ] **Step 7: Final commit**

```bash
mkdir -p rag-data && touch rag-data/.gitkeep
echo "rag-data/*.json" >> .gitignore
git add rag-data/.gitkeep .gitignore
git commit -m "chore: ignore rag-data index files, add .gitkeep"
```
