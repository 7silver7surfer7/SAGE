import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useUpdateUserMutation, useGetUserQuery } from '@/store/usersReducer';
import { useSetProfileImageMutation } from '@/store/socialReducer';
import { PfpImage } from '@/components/Media/BaseMedia';
import MediaCropModal from './MediaCropModal';

/**
 * Twitter-style "Edit profile": banner + avatar with camera overlays at the
 * top, then boxed fields (Name / Bio / Location / Website) with floating
 * labels and a Save pill in the header — the interface people already know.
 */
export default function EditProfileModal({
  address,
  initial,
  onClose,
  onSaved,
}: {
  address: string;
  initial: {
    username: string | null;
    bio: string | null;
    webpage: string | null;
    location: string | null;
    profilePicture: string | null;
    bannerImageS3Path: string | null;
  };
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data: user } = useGetUserQuery();
  const [updateUser] = useUpdateUserMutation();
  const [setProfileImage] = useSetProfileImageMutation();
  const [username, setUsername] = useState(initial.username || '');
  const [bio, setBio] = useState(initial.bio || '');
  const [location, setLocation] = useState(initial.location || '');
  const [webpage, setWebpage] = useState(initial.webpage || '');
  const [avatarPreview, setAvatarPreview] = useState(initial.profilePicture);
  const [bannerPreview, setBannerPreview] = useState(initial.bannerImageS3Path);
  const [busy, setBusy] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  // Twitter-style crop step: the picked file waits here while the user
  // repositions/zooms; onImage only runs once they hit Apply.
  const [cropping, setCropping] = useState<{ kind: 'avatar' | 'banner'; file: File } | null>(null);

  const onImage = async (kind: 'avatar' | 'banner', file?: File) => {
    if (!file) return;
    const t = toast.loading(`Uploading ${kind}…`);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/social-upload/?kind=${kind}`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'upload failed');
      await setProfileImage({ url: data.url, kind, address }).unwrap();
      if (kind === 'avatar') setAvatarPreview(data.url);
      else setBannerPreview(data.url);
      toast.update(t, {
        render: `${kind === 'banner' ? 'Banner' : 'Avatar'} updated`,
        type: 'success',
        isLoading: false,
        autoClose: 2500,
      });
    } catch (e: any) {
      toast.update(t, {
        render: e?.message?.slice(0, 80) || 'Upload failed',
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const res: any = await updateUser({
        ...(user || {}),
        username: username.trim() || null,
        bio: bio.trim() || null,
        location: location.trim() || null,
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

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { max: number; textarea?: boolean; placeholder?: string }
  ) => (
    <label className='social-editx__field'>
      <span className='social-editx__label'>{label}</span>
      {opts.textarea ? (
        <textarea
          value={value}
          maxLength={opts.max}
          rows={3}
          placeholder={opts.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      ) : (
        <input
          value={value}
          maxLength={opts.max}
          placeholder={opts.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </label>
  );

  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-editx' onClick={(e) => e.stopPropagation()}>
        <div className='social-editx__head'>
          <button className='social-verify__close' onClick={onClose}>
            ✕
          </button>
          <h3>Edit profile</h3>
          <button className='social-editx__save' disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* banner + avatar, Twitter-style with camera overlays */}
        <div className='social-editx__banner' onClick={() => bannerRef.current?.click()}>
          {bannerPreview && <PfpImage src={bannerPreview} />}
          <span className='social-editx__cam'>📷</span>
        </div>
        <div className='social-editx__avatar' onClick={() => avatarRef.current?.click()}>
          <PfpImage src={avatarPreview} />
          <span className='social-editx__cam'>📷</span>
        </div>
        <input
          ref={avatarRef}
          type='file'
          accept='image/jpeg,image/png,image/webp'
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setCropping({ kind: 'avatar', file: f });
            e.target.value = '';
          }}
        />
        <input
          ref={bannerRef}
          type='file'
          accept='image/jpeg,image/png,image/webp'
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setCropping({ kind: 'banner', file: f });
            e.target.value = '';
          }}
        />
        {cropping && (
          <MediaCropModal
            file={cropping.file}
            kind={cropping.kind}
            onCancel={() => setCropping(null)}
            onApply={(cropped) => {
              const kind = cropping.kind;
              setCropping(null);
              onImage(kind, cropped);
            }}
          />
        )}

        <div className='social-editx__fields'>
          {field('Name', username, setUsername, { max: 40, placeholder: 'Your name' })}
          {field('Bio', bio, setBio, {
            max: 1000,
            textarea: true,
            placeholder: 'Tell the network who you are',
          })}
          {field('Location', location, setLocation, { max: 60, placeholder: 'Where in the world' })}
          {field('Website', webpage, setWebpage, { max: 50, placeholder: 'https://…' })}
        </div>
      </div>
    </div>
  );
}
