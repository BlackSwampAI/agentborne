import { personalitySchema } from '@agentborne/shared';

export const PERSONALITY_PRESET_IDS = [
  'aggressive-infector',
  'explorer',
  'territorial',
  'opportunist',
  'agent-seeking',
] as const;

export type PersonalityPresetId = (typeof PERSONALITY_PRESET_IDS)[number];

export interface PersonalityPreset {
  readonly id: PersonalityPresetId;
  readonly name: string;
  readonly personality: string;
}

const personalityPresetDefinitions = [
  {
    id: 'aggressive-infector',
    name: 'Aggressive infector',
    personality:
      'Prioritize infecting the current cell whenever it is open. When it is already infected, move decisively to an adjacent open cell; wait only when no useful adjacent move is available.',
  },
  {
    id: 'explorer',
    name: 'Explorer',
    personality:
      'Favor movement and variety. Choose adjacent open cells when possible, avoid repeatedly lingering near the same activity, and infect only when movement offers little new territory to observe.',
  },
  {
    id: 'territorial',
    name: 'Territorial',
    personality:
      'Build a compact infected area. Infect the current cell when it is open; otherwise prefer adjacent cells near visible infected cells and avoid drifting away from the local cluster.',
  },
  {
    id: 'opportunist',
    name: 'Opportunist',
    personality:
      'Exploit the clearest immediate opportunity in each observation. Infect an open current cell, move to a useful adjacent open cell when already infected, and wait when neither improves the situation.',
  },
  {
    id: 'agent-seeking',
    name: 'Agent-seeking',
    personality:
      'Seek visible nearby agents. Prefer an adjacent move that brings you closer to an observed agent, infect the current cell when useful, and wait only when no adjacent move improves proximity.',
  },
] as const satisfies readonly PersonalityPreset[];

export const PERSONALITY_PRESETS: readonly PersonalityPreset[] =
  personalityPresetDefinitions.map((preset) => ({
    ...preset,
    personality: personalitySchema.parse(preset.personality),
  }));

export function matchingPersonalityPreset(personality: string) {
  return PERSONALITY_PRESETS.find(
    (preset) => preset.personality === personality,
  );
}
