import { useEffect, useState } from 'react';

type Props = {
  file: File;
  previewWidth?: number;
};

export default function MediaPreview({ file, previewWidth }: Props) {
  const [previewSrc, setPreviewSrc] = useState<string>();
  const isVideo: boolean = file?.type == 'video/mp4';

  useEffect(() => {
    handleBrowserSupportedFileUpload();
  }, [file]);

  function handleBrowserSupportedFileUpload() {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result: string = reader.result as string;
      setPreviewSrc(result);
    };
    reader.readAsDataURL(file);
  }

  if (!previewSrc) {
    return null;
  }
  return isVideo ? (
    <video autoPlay muted loop playsInline className='border border-dark rounded' width={previewWidth || 150}>
      <source src={previewSrc} type='video/mp4'></source>
    </video>
  ) : (
    <img src={previewSrc} className='border border-dark rounded' width={previewWidth || 150} />
  );
}
