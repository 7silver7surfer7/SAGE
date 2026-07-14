import { useRef, useState } from 'react';
import AvatarEditor from 'react-avatar-editor';

interface Props {
  file: File;
  kind: 'avatar' | 'banner';
  onApply: (file: File) => void;
  onCancel: () => void;
}

/**
 * Twitter-style "Edit media": drag to reposition, slide to zoom, Apply.
 * The server still center-crops on upload as a safety net (kind=avatar →
 * 400² cover, kind=banner → 1500×500 cover) — this step is what lets the
 * PERSON choose what's in that crop instead of a blind center-crop chopping
 * off the exact part of the image (a signature, a face, a word) they wanted.
 */
export default function MediaCropModal({ file, kind, onApply, onCancel }: Props) {
  const [scale, setScale] = useState(1);
  const editorRef = useRef<any>(null);
  const isAvatar = kind === 'avatar';
  // preview canvas — square for avatar (matches the circular badge), wide
  // 3:1 for banner (matches the 1500×500 server crop)
  const width = isAvatar ? 320 : 480;
  const height = isAvatar ? 320 : 160;

  const apply = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const canvas = editor.getImageScaledToCanvas();
    canvas.toBlob((blob) => {
      if (!blob) return;
      onApply(new File([blob], file.name.replace(/\.\w+$/, '.png'), { type: 'image/png' }));
    }, 'image/png');
  };

  return (
    <div className='social-verify__overlay' onClick={onCancel}>
      <div className='media-crop' onClick={(e) => e.stopPropagation()}>
        <div className='media-crop__head'>
          <button className='media-crop__back' onClick={onCancel}>←</button>
          <h3>Edit media</h3>
          <button className='media-crop__apply' onClick={apply}>Apply</button>
        </div>
        <div className='media-crop__stage'>
          <AvatarEditor
            ref={editorRef}
            image={file}
            width={width}
            height={height}
            border={24}
            borderRadius={isAvatar ? width : 6}
            color={[0, 0, 0, 0.55]}
            scale={scale}
            rotate={0}
          />
        </div>
        <div className='media-crop__zoom'>
          <span>−</span>
          <input
            type='range'
            min={1}
            max={3}
            step={0.01}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <span>+</span>
        </div>
      </div>
    </div>
  );
}
