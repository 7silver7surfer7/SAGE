import { SystemTypes } from '@/components/Icons/System';
import { transformTitle } from '@/utilities/strings';
import { Nft } from '@prisma/client';

interface Args {
  systemType: SystemTypes;
  editionSize: Nft['numberOfEditions'];
}

export default function useEditionSize({ systemType, editionSize }: Args) {
  const isOneOfOne: boolean = editionSize === 1;
  const editionsText: string = isOneOfOne
    ? `1 of 1 ${transformTitle(systemType)}`
    : `${transformTitle(systemType)} of ${editionSize} Editions`;

  return { editionsText };
}
