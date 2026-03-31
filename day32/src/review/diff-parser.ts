export interface FileDiff {
  path: string;
  hunks: string;
}

export interface ParsedDiff {
  files: string[];
  fileDiffs: FileDiff[];
  summary: string;
}

export function parseDiff(rawDiff: string): ParsedDiff {
  if (!rawDiff.trim()) {
    return { files: [], fileDiffs: [], summary: 'no changes' };
  }

  const lines = rawDiff.split('\n');
  const fileDiffsMap = new Map<string, string[]>();
  let currentFile: string | null = null;

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      if (!fileDiffsMap.has(currentFile)) {
        fileDiffsMap.set(currentFile, []);
      }
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // skip old/new file header lines
    } else if (
      currentFile &&
      (line.startsWith('@@') ||
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith(' '))
    ) {
      fileDiffsMap.get(currentFile)!.push(line);
    }
  }

  const files = Array.from(fileDiffsMap.keys());
  const fileDiffs: FileDiff[] = files.map((path) => ({
    path,
    hunks: fileDiffsMap.get(path)!.join('\n'),
  }));

  const listed = files.slice(0, 5).join(', ');
  const extra = files.length > 5 ? ` and ${files.length - 5} more` : '';
  const summary = `changes in ${listed}${extra}`;

  return { files, fileDiffs, summary };
}
