import { useState } from 'react';
import { toast } from 'react-toastify';
import { useUpdateUserMutation, useGetUserQuery } from '@/store/usersReducer';

/**
 * Edit your SAGE Social profile: display name, bio, and website. Writes
 * through the existing /api/user PATCH (username/bio/webpage), then calls
 * onSaved so the parent refetches the social profile.
 */
export default function EditProfileModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: { username: string | null; bio: string | null; webpage: string | null };
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data: user } = useGetUserQuery();
  const [updateUser] = useUpdateUserMutation();
  const [username, setUsername] = useState(initial.username || '');
  const [bio, setBio] = useState(initial.bio || '');
  const [webpage, setWebpage] = useState(initial.webpage || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      // merge onto the existing user so we don't blank other fields
      const res: any = await updateUser({
        ...(user || {}),
        username: username.trim() || null,
        bio: bio.trim() || null,
        webpage: webpage.trim() || null,
      } as any);
      if (res?.data?.error || res?.error) throw new Error(res?.data?.error || 'update failed');
      onSaved?.();
      toast.success('Profile updated');
      onClose();
    } catch (e: any) {
      toast.error(
        /unique|in use/i.test(e?.message || '')
          ? 'That name is taken — pick another'
          : e?.message?.slice(0, 80) || 'Could not update'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify social-verify--launch' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>Edit profile</h3>
          <button className='social-verify__close' onClick={onClose}>
            ✕
          </button>
        </div>
        <label className='social-edit__label'>Display name</label>
        <input
          className='social-search__input'
          placeholder='e.g. chartreuse_monet'
          value={username}
          maxLength={40}
          onChange={(e) => setUsername(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <label className='social-edit__label'>Bio</label>
        <textarea
          className='social-search__input'
          placeholder='A line about you'
          value={bio}
          maxLength={1000}
          rows={3}
          onChange={(e) => setBio(e.target.value)}
          style={{ marginBottom: 12, resize: 'vertical', minHeight: 64 }}
        />
        <label className='social-edit__label'>Website</label>
        <input
          className='social-search__input'
          placeholder='https://…'
          value={webpage}
          maxLength={80}
          onChange={(e) => setWebpage(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <button className='social-verify__buy' disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
