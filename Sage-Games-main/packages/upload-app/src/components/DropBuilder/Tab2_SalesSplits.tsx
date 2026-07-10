import { BriefcaseIcon, ChartPieIcon, ReceiptTaxIcon } from '@heroicons/react/outline';

type Props = {
  formData: any;
  setFormData: (formData: any) => void;
};

export const Tab2_SalesSplits = ({ ...props }: Props) => {
  const handleFieldChange = (e: any) => {
    const { name, value } = e.target;
    props.setFormData((prevData: any) => ({ ...prevData, [name]: value }));
  };

  return (
    <div className='mt-4 container-lg px-4'>
      {[1, 2, 3, 4].map((idx) => {
        return (
          <div className='row' key={idx}>
            <div className='col-4 mb-3'>
              <label>
                <ChartPieIcon width={20} style={{ marginRight: 5, rotate: `${idx * 90 - 90}deg` }} />
                Primary Sales Split {idx} (%) {idx == 1 && '*'}
              </label>
              <input
                type='text'
                className='form-control'
                name={`pmySalesSplit${idx}`}
                id={`pmySalesSplit${idx}`}
                onChange={handleFieldChange}
              />
            </div>
            <div className='col-8'>
              <label>
                <BriefcaseIcon width={20} style={{ marginRight: 5 }} />
                Destination Wallet {idx}
              </label>
              <input
                type='text'
                className='form-control'
                name={`pmySalesSplitAddr${idx}`}
                id={`pmySalesSplitAddr${idx}`}
                onChange={handleFieldChange}
              />
            </div>
          </div>
        );
      })}

      <hr className='mt-2' />

      <div className='row'>
        <div className='col-4'>
          <label>
            <ReceiptTaxIcon width={20} style={{ marginRight: 5 }} />
            Royalties % (Secondary Sales) *
          </label>
          <input
            type='text'
            className='form-control'
            name='rltyPercent'
            id='rltyPercent'
            onChange={handleFieldChange}
            placeholder='12'
          />
        </div>
        <div className='col-8'></div>
      </div>

      {[1, 2, 3, 4].map((idx) => {
        return (
          <div className='row mt-3' key={idx}>
            <div className='col-4'>
              <label>
                <ChartPieIcon width={20} style={{ marginRight: 5, rotate: `${idx * 90 - 90}deg` }} />
                Royalties Split {idx} (%) {idx == 1 && '*'}
              </label>
              <input
                type='text'
                className='form-control'
                name={`rltySplit${idx}`}
                id={`rltySplit${idx}`}
                onChange={handleFieldChange}
              />
            </div>
            <div className='col-8'>
              <label>
                <BriefcaseIcon width={20} style={{ marginRight: 5 }} />
                Destination Wallet {idx}
              </label>
              <input
                type='text'
                className='form-control'
                name={`rltySplitAddr${idx}`}
                id={`rltySplitAddr${idx}`}
                onChange={handleFieldChange}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
