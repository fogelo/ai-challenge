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
