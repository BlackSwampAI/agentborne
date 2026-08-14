import { parseEnv } from 'node:util';

const smokeEnvironmentNames = [
  'OPENROUTER_API_KEY',
  'AGENTBORNE_MODEL',
] as const;

export function applySmokeEnvironmentFile(
  contents: string,
  environment: Record<string, string | undefined> = process.env,
): void {
  let fileEnvironment: Record<string, string | undefined>;
  try {
    fileEnvironment = parseEnv(contents);
  } catch {
    throw new Error('The repository .env file could not be parsed.');
  }

  for (const name of smokeEnvironmentNames) {
    if (fileEnvironment[name] !== undefined) {
      environment[name] = fileEnvironment[name];
    }
  }
}
