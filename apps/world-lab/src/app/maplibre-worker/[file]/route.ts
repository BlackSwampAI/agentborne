import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound } from 'next/navigation';

const mapLibreWorkerFiles = new Set([
  'maplibre-gl-shared.mjs',
  'maplibre-gl-worker.mjs',
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  if (!mapLibreWorkerFiles.has(file)) notFound();

  const contents = await readFile(
    join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', file),
  );

  return new Response(contents, {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'text/javascript; charset=utf-8',
    },
  });
}
