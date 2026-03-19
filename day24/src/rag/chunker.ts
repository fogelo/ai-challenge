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
      if (hasHeadings && currentLines.length > 0) {
        const chunkText = currentLines.join('\n').trim();
        if (chunkText) {
          chunks.push({ heading: currentHeading, text: chunkText });
        }
      }
      hasHeadings = true;
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
