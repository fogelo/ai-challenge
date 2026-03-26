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
