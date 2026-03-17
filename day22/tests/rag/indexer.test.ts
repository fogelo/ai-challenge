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
