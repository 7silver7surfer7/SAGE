import { useState } from 'react';

export default function useDropDown(options: string[]) {
  type FilterOption = typeof options[number];
  const [currentOption, setCurrentOption] = useState<FilterOption>(options[0]);

  return { currentOption, setCurrentOption };
}
