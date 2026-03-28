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
