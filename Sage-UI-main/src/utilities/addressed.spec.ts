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

  /**
   * The regression that made the bot interrupt a conversation it was not part
   * of. Once we have replied in a thread, X prepends our handle to every later
   * reply and hides it, so this text is what arrives when one human answers
   * another human. Reading the lead block alone, it is identical to a summons.
   */
  it('ignores a reply between two other people once we have spoken in the thread', () => {
    const text = '@_holonick_ @sageartxyz Part of it is, most of it is new. I kept the design.';
    expect(isAddressed(m(text, { selfSpokeInThread: true }))).to.equal(false);
  });
  it('answers that same shape when we have NOT spoken in the thread', () => {
    // nobody but the author could have put our handle there
    const text = '@_holonick_ @sageartxyz what do you make of this?';
    expect(isAddressed(m(text, { selfSpokeInThread: false }))).to.equal(true);
  });
  it('still answers a direct reply to us even inside a thread we are in', () => {
    expect(
      isAddressed(m('go on then', { selfSpokeInThread: true, inReplyToUserId: SELF.selfUserId }))
    ).to.equal(true);
  });
  it('still answers a re-summons typed into the body of a thread we are in', () => {
    const text = '@_holonick_ @sageartxyz generate a cyberpunk whale for me';
    expect(isAddressed(m(text, { selfSpokeInThread: true }))).to.equal(true);
  });
});
