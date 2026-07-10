import System, { SystemTypes } from '@/components/Icons/System';
import useEditionSize from '@/hooks/useEditionSize';
interface Props {
  editionSize: number;
  systemType: SystemTypes;
}

export default function TileHeader({ editionSize, systemType }: Props) {
  const { editionsText } = useEditionSize({ editionSize, systemType });
  return (
    <div className='drop-page__grid-item-header'>
      <h1 className='drop-page__grid-item-header-left'>{editionsText}</h1>
      <div className='drop-page__grid-item-header-right'>
        System:
        <div className='drop-page__grid-item-systems-icon'>
          <System type={systemType}></System>
        </div>
      </div>
    </div>
  );
}
