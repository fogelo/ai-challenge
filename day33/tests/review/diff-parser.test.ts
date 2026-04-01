import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/review/diff-parser.js';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
-  return 1;
+  return 2;
+  // changed
 }
diff --git a/src/bar.ts b/src/bar.ts
index 111..222 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -5,6 +5,7 @@
 export function bar() {
+  console.log('added');
 }`;

describe('parseDiff', () => {
  it('extracts changed file paths', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('creates fileDiffs with hunks per file', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.fileDiffs).toHaveLength(2);
    expect(result.fileDiffs[0].path).toBe('src/foo.ts');
    expect(result.fileDiffs[0].hunks).toContain('@@ -1,3 +1,4 @@');
  });

  it('generates a natural-language summary', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.summary).toContain('src/foo.ts');
    expect(result.summary).toContain('src/bar.ts');
  });

  it('returns empty result for empty diff', () => {
    const result = parseDiff('');
    expect(result.files).toEqual([]);
    expect(result.fileDiffs).toEqual([]);
    expect(result.summary).toBe('no changes');
  });

  it('does not include file header lines in hunks', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.fileDiffs[0].hunks).not.toContain('--- a/');
    expect(result.fileDiffs[0].hunks).not.toContain('+++ b/');
  });
});
