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
