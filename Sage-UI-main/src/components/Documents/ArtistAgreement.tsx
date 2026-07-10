import { Text, Subheader, Group, List } from '@/components/Static';

import React from 'react';

function ArtistAgreement() {
  return (
    <>
      <Group>
        <h1 className='submissions-page__header'>Artist Agreement</h1>
        <Text>
          SAGE WEB3 INC. (“SAGE”, “we”, “us”. “our”) hereby enters into this agreement with the
          Artist (“you” or “Artist”). This agreement incorporates SAGE’s Terms of Use, as well as
          SAGE’s Privacy Policy. Collectively, these documents are referred to as “the Agreement”.
          The Agreement sets forth the terms and conditions governing the relationship between you
          and SAGE with respect to the services described herein. SAGE reserves the right to change
          or modify this Agreement at any time, in its sole discretion. You agree and understand
          that by accessing or using the services following any change to this Agreement, you agree
          to the revised Agreement and all of the terms incorporated therein by reference.
        </Text>
      </Group>

      <Group>
        <Subheader>Services</Subheader>
        <Text>
          SAGE offers Artists minting services and publishing services. Minting services involve you
          providing SAGE content from which SAGE creates NFT(s) and recording it on the blockchain.
          In order to use the minting services, you must agree to be bound by the intellectual
          property requirements as well as the representations and warranties set forth in the Terms
          of Use.
        </Text>
        <Text>
          Publishing services involve SAGE making NFTs available for purchase. These may be NFTs
          minted for you by SAGE, or NFTs that you have had minted elsewhere. In order to use the
          publishing services, you must agree to be bound by the intellectual property requirements
          as well as the representations and warranties set forth in the Terms of Use.
        </Text>
      </Group>
      <Group>
        <Subheader>User Account and Profiles</Subheader>
        <Text>
          In order to use the minting service and the publishing service, you need to create and
          maintain a User Account. When you create a User Account, you will also create a User
          Profile and an Artist Profile. Please refer to the Terms of Use for more information on
          creating these profiles, and to the Privacy Policy for information on how the information
          in these profiles is used.
        </Text>
      </Group>
      <Group>
        <Subheader>Sales And Royalties</Subheader>
        <Text>
          You may sell NFTs through the use of SAGE’s Services. The initial selling price of the NFT
          will be set by you in cooperation with SAGE. Any NFT minted through SAGE must be initially
          sold through the use of SAGE’s Services. Subsequent sales may be made on any platform.
          SAGE does not sell NFTs minted elsewhere.
        </Text>
        <Text>
          SAGE takes a commission in the amount of 20% of all proceeds from the initial sale of NFTs
          through use of the Services. SAGE further receives payment for transaction fees to cover
          the cost of payment processing.
        </Text>
        <Text>
          SAGE takes a commission in the amount of 2% of all proceeds from all subsequent sales of
          NFTs. SAGE further receives payment for transaction fees to cover the cost of payment
          processing if such subsequent sales are made using the Services. You may also receive a
          percentage of proceeds from such subsequent sales, in an amount negotiated by you of up to
          10%.{' '}
        </Text>
        <Text>
          Upon a successful sale through SAGE’s Services, SAGE will retain its royalties and fees
          and tender the balance to you. However, SAGE cannot guarantee the payment of any royalty
          to you from a subsequent sale if made independently of SAGE’s Services. You are
          responsible to pay any and all sales, use, value-added and other taxes, duties, and
          assessments now or hereafter claimed or imposed by any governmental authority, associated
          with your use of the Services, including, without limitation, any taxes that may become
          payable as the result of your ownership, transfer, purchase, sale, or creation of any
          artworks.
        </Text>
        <Text>
          Users acknowledge and consent to the risk that the price of any item purchased through use
          of the Services may have been influenced by activity outside of the control of SAGE. SAGE
          does not represent, guarantee, or warrant the accuracy or fairness of the price of asset
          sold or offered for sale through the use of the Services or through outside services. User
          agrees and acknowledges that SAGE is not a fiduciary nor owes any duties to any user of
          the Services, including the duty to ensure fair pricing of assets or to police user
          behavior of the Services.
        </Text>
      </Group>
      <Group>
        <Subheader>Entire Agreement</Subheader>
        <Text>
          The Agreement constitutes the complete terms agreed by the parties in relation to its
          subject matter and supersedes any and all prior agreements, understandings or arrangements
          between them, whether oral or in writing, in relation to such matters. No course of
          dealing, usage of trade or course of performance will be construed to supplement, amend or
          construe any term, condition or instruction of this Agreement.
        </Text>
      </Group>
    </>
  );
}

export default ArtistAgreement;
