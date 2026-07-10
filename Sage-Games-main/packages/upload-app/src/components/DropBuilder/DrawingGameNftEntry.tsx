import { DocumentTextIcon, DuplicateIcon, PhotographIcon, TagIcon, TrashIcon } from '@heroicons/react/outline';
import Tags from './Tags';
import MediaPreview from '../MediaPreview';

type Props = {
  drawingIndex: number; // index of parent drawing on drawings array
  nftIndex: number; // index of this nft on drawing's nfts array
  data: any; // nft entry data
  onDelete: (index: number) => void; // callback for when user deletes this entry
  onFieldChange: (index: number, name: string, value: any) => void; // callback to update form data upon field change
};

export const DrawingGameNftEntry = ({ ...props }: Props) => {
  const handleFieldChange = (e: any) => {
    const val = e.target.hasOwnProperty('checked') ? e.target.checked.toString() : e.target.value;
    props.onFieldChange(props.nftIndex, e.target.name, val);
  };

  // const onTagsChange = (newValue: string) => {
  //   props.onFieldChange(props.nftIndex, 'tags', newValue);
  // };

  return (
    <table cellPadding={20} style={{ border: '1px solid #ddd' }}>
      <tbody>
        <tr>
          <td width='16%'>
            {props.data.previewJSX}
            <div className='mt-2 text-center'>
              <TrashIcon width='20' role='button' onClick={() => props.onDelete(props.nftIndex)} />
            </div>
          </td>
          <td width='42%' style={{ verticalAlign: 'top' }}>
            <label>
              <PhotographIcon width='20' style={{ marginRight: 5 }} />
              NFT Name *
            </label>
            <input
              type='text'
              className='form-control'
              name='name'
              onChange={handleFieldChange}
              value={props.data.name}
            />
            <label className='mt-3'>
              <DuplicateIcon width='20' style={{ marginRight: 5 }} />
              Editions *
            </label>
            <input
              type='number'
              className='form-control'
              name='numberOfEditions'
              onChange={handleFieldChange}
              value={props.data.numberOfEditions}
            />
          </td>
          <td width='42%' style={{ verticalAlign: 'top' }}>
            <label>
              <DocumentTextIcon width='20' style={{ marginRight: 5 }} />
              Description *
            </label>
            <textarea
              className='form-control md-textarea'
              name='description'
              rows={3}
              onChange={handleFieldChange}
              value={props.data.description}
            />
          </td>
        </tr>
      </tbody>
    </table>
  );
};
