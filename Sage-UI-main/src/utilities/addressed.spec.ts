import { expect } from 'chai';
import { isAddressed } from './xMentions';

const SELF = { selfHandle: 'sageartxyz', selfUserId: '1187436872173273091' };
const m = (text: string, extra: any = {}) =>
  ({ tweetId: '1', authorXUserId: '1', authorHandle: 'x', text, ...SELF, ...extra } as any);

describe('xMentions :: isAddressed', () => {
  it('answers a summons that X pushed out of first position', () => {
    // the exact text X delivered for tweet 2081414915244409217
    expect(isAddressed(m('@vladtenev @sageartxyz do some advanced math for us'))).to.equal(true);
  });
  it('still answers a plain leading summons', () => {
    expect(isAddressed(m('@sageartxyz what do you think'))).to.equal(true);
  });
  it('still answers a direct reply to us', () => {
    expect(isAddressed(m('sure, go on', { inReplyToUserId: SELF.selfUserId }))).to.equal(true);
  });
  it('still ignores a referential brand mention', () => {
    expect(isAddressed(m('just minted this on @sageartxyz, so hyped'))).to.equal(false);
  });
  it('still ignores small talk that merely names us mid-thread', () => {
    expect(isAddressed(m('@someone yeah I saw it via @sageartxyz earlier'))).to.equal(false);
  });
});
