import { describe, expect, it } from 'vitest';
import { selectRotatedQueries } from '../src/collectors/opencli/query-budget.js';

describe('query budgets', () => {
  it('never executes more than the configured maximum and rotates deterministically', () => {
    const queries = Array.from({ length: 7 }, (_, index) => ({ id: `q-${index}`, query: `query ${index}`, enabled: true }));
    const first = selectRotatedQueries(queries, 4, new Date('2026-08-12T00:00:00Z'));
    const sameDay = selectRotatedQueries(queries, 4, new Date('2026-08-12T23:00:00Z'));
    const nextDay = selectRotatedQueries(queries, 4, new Date('2026-08-13T00:00:00Z'));
    expect(first).toHaveLength(4);
    expect(sameDay).toEqual(first);
    expect(nextDay).not.toEqual(first);
  });
});
