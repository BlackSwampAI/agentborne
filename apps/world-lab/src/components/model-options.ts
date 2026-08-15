import type { CompatibleModel } from '@agentborne/shared';

export interface ModelOption {
  value: string;
  label: string;
  model: CompatibleModel;
}

const modelCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

export function formatModelOption(model: CompatibleModel): string {
  const input = formatPerMillion(model.inputPricePerToken);
  const output = formatPerMillion(model.outputPricePerToken);
  return `${model.id} — ${model.name} · ${input} in / ${output} out`;
}

export function buildModelOptions(models: CompatibleModel[]): ModelOption[] {
  const unique = new Map<string, CompatibleModel>();
  for (const model of models) unique.set(model.id, model);
  return [...unique.values()]
    .sort(
      (left, right) =>
        modelCollator.compare(left.id, right.id) ||
        left.id.localeCompare(right.id),
    )
    .map((model) => ({
      value: model.id,
      label: formatModelOption(model),
      model,
    }));
}

function formatPerMillion(pricePerToken: string): string {
  const value = Number(pricePerToken) * 1_000_000;
  return value === 0 ? 'free' : `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}
