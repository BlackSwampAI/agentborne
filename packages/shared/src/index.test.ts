import { describe, expect, it } from 'vitest';
import { requestedActionSchema } from './index';

describe('requestedActionSchema', () => {
  it.each([
    { type: 'move', targetCell: '892a1072893ffff' },
    { type: 'infect' },
    {
      type: 'message',
      recipientId: 'ca0e2b4d-d88f-4c9e-a401-a7b740c6e5af',
      message: 'Meet me at the edge.',
    },
    { type: 'wait' },
  ])('accepts a structured $type action', (action) => {
    expect(requestedActionSchema.safeParse(action).success).toBe(true);
  });

  it('rejects invented action verbs', () => {
    expect(
      requestedActionSchema.safeParse({
        type: 'teleport',
        targetCell: '892a1072893ffff',
      }).success,
    ).toBe(false);
  });
});
