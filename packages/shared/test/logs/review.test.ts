import { describe, expect, it } from 'vitest';
import { logReviewByLog } from '../../src/logs/review';

const CLIENT = 'client-1';
const COACH = 'coach-1';

describe('logReviewByLog', () => {
  it('a log with no comments is unreviewed with 0 comments', () => {
    const map = logReviewByLog([{ id: 'a', clientId: CLIENT }], []);
    expect(map.get('a')).toEqual({ comments: 0, reviewed: false });
  });

  it('only the client’s own comments leave it unreviewed, but they count', () => {
    const map = logReviewByLog([{ id: 'a', clientId: CLIENT }], [
      { logId: 'a', authorId: CLIENT },
      { logId: 'a', authorId: CLIENT },
    ]);
    expect(map.get('a')).toEqual({ comments: 2, reviewed: false });
  });

  it('a comment from anyone other than the client (the coach) marks it reviewed', () => {
    const map = logReviewByLog([{ id: 'a', clientId: CLIENT }], [
      { logId: 'a', authorId: CLIENT },
      { logId: 'a', authorId: COACH },
    ]);
    expect(map.get('a')).toEqual({ comments: 2, reviewed: true });
  });

  it('a comment whose author account is gone counts but does not mark it reviewed', () => {
    const map = logReviewByLog([{ id: 'a', clientId: CLIENT }], [{ logId: 'a', authorId: null }]);
    expect(map.get('a')).toEqual({ comments: 1, reviewed: false });
  });

  it('keeps logs apart and ignores comments on logs it was not asked about', () => {
    const map = logReviewByLog(
      [
        { id: 'a', clientId: CLIENT },
        { id: 'b', clientId: 'client-2' },
      ],
      [
        { logId: 'b', authorId: COACH },
        { logId: 'z', authorId: COACH },
      ],
    );
    expect(map.get('a')).toEqual({ comments: 0, reviewed: false });
    expect(map.get('b')).toEqual({ comments: 1, reviewed: true });
    expect(map.has('z')).toBe(false);
  });
});
