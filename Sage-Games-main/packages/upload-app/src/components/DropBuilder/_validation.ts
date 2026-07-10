import { ethers } from 'ethers';

export function validate(data: any): string[] {
  const err = [];

  const checkRequired = (val: string): boolean => {
    if (typeof val !== 'string') {
      return false;
    }
    return val && val.trim().length > 0;
  };

  const checkForAnyPosNumbers = (names: string[]): boolean => {
    for (const name of names) if (checkReqPosNumber(name)) return true;
    return false;
  };

  const checkPosNumber = (val: string): boolean => {
    return val == undefined || val == '' || checkReqPosNumber(val);
  };

  const checkReqPosNumber = (val: string): boolean => {
    try {
      return Number(val) >= 0;
    } catch (e) {
      return false;
    }
  };

  const checkPosInt = (val: string): boolean => {
    return val == undefined || val == '' || checkReqPosInt(val);
  };

  const checkReqPosInt = (val: string): boolean => {
    try {
      const valNo = Number(val);
      return valNo >= 0 && Math.floor(valNo) == valNo;
    } catch (e) {
      return false;
    }
  };

  const checkSumIs100 = (values: string[]): boolean => {
    let sum = 0.0;
    try {
      for (let val of values) {
        if (!val) continue;
        let valf = parseFloat(val);
        if (valf !== NaN) {
          sum += valf;
        }
      }
    } catch (e) {}
    return sum === 100.0;
  };

  const checkAddress = (value: string): boolean => {
    try {
      ethers.utils.getAddress(value);
      return true;
    } catch (e) {
      return false;
    }
  };

  const validateTab1 = (data: any) => {
    if (!checkRequired(data.name)) err.push('[Drop Details] Drop Name is required');
    if (!checkRequired(data.target)) err.push('[Drop Details] Target System is required');
    if (!checkRequired(data.artistWallet)) err.push('[Drop Details] Artist Wallet Address is required');
    if ('new' == data.whitelist) {
      if (!checkRequired(data.whitelistNewEntryName)) err.push('[Drop Details] Whitelist Entry Name is required');
      if (!checkRequired(data.whitelistNewEntryToken)) err.push('[Drop Details] Whitelist Token Address is required');
      if (!checkAddress(data.whitelistNewEntryToken)) err.push('[Drop Details] Whitelist Token Address is not valid');
      if (!checkRequired(data.whitelistNewEntryMinBalance)) err.push('[Drop Details] Minimum Balance is required');
      if (!checkReqPosNumber(data.whitelistNewEntryMinBalance))
        err.push('[Drop Details] Minimum Balance must be a number');
    }
    if (!checkAddress(data.artistWallet)) err.push('[Drop Details] Artist Wallet Address is not valid');
    if (!checkRequired(data.bannerImageFile?.name)) err.push('[Drop Details] Home Page Banner Image is required');
    if (!checkRequired(data.description)) err.push('[Drop Details] Drop description is required');
  };

  const validateTab2 = (data: any) => {
    if (!checkSumIs100([data.pmySalesSplit1, data.pmySalesSplit2, data.pmySalesSplit3, data.pmySalesSplit4]))
      err.push('[Sales & Splits] Primary Sales Splits must add to 100%');
    if (!checkReqPosNumber(data.rltyPercent)) err.push('[Sales & Splits] Royalties must be a number');
    if (!checkSumIs100([data.rltySplit1, data.rltySplit2, data.rltySplit3, data.rltySplit4]))
      err.push('[Sales & Splits] Royalties Splits must add to 100%');
    for (var i of [1, 2, 3, 4]) {
      if (checkReqPosNumber(data[`pmySalesSplit${i}`]) && !checkAddress(data[`pmySalesSplitAddr${i}`]))
        err.push(`[Sales & Splits] Primary Sales Destination Wallet ${i} is not valid`);
      if (checkReqPosNumber(data[`rltySplit${i}`]) && !checkAddress(data[`rltySplitAddr${i}`]))
        err.push(`[Sales & Splits] Royalties Destination Wallet ${i} is not valid`);
    }
  };

  const validateTab3 = (data: any) => {
    for (const [i, a] of data.auctionGames.entries()) {
      if (!checkRequired(a.name)) err.push(`[Auction Games] Auction ${i + 1}: NFT Name is required`);
      if (!checkRequired(a.startDate)) err.push(`[Auction Games] Auction ${i + 1}: Start Date is required`);
      // if (!checkRequired(a.endDate)) err.push(`[Auction Games] Auction ${i + 1}: End Date is required`);
      // if (!checkRequired(a.tags)) err.push(`[Auction Games] Auction ${i + 1}: NFT must have at least one tag`);
      if (a.endDate <= a.startDate) err.push(`[Auction Games] Auction ${i + 1}: End Date must be after Start Date`);
      if (!checkReqPosNumber(a.minPrice)) err.push(`[Auction Games] Auction ${i + 1}: Minimum Price must be a number`);
      if (!checkRequired(a.description)) err.push(`[Auction Games] Auction ${i + 1}: Description is required`);
    }
  };

  const validateTab4 = (data: any) => {
    for (const [i, d] of data.drawingGames.entries()) {
      if (!checkRequired(d.startDate)) err.push(`[Drawing Games] Drawing ${i + 1}: Start Date is required`);
      if (!checkRequired(d.endDate)) err.push(`[Drawing Games] Drawing ${i + 1}: End Date is required`);
      if (d.endDate <= d.startDate) err.push(`[Drawing Games] Drawing ${i + 1}: End Date must be after Start Date`);
      // if (!checkRequired(d.ticketCostTokens))
      //   err.push(`[Drawing Games] Drawing ${i + 1}: ASH Cost is required`);
      if (!checkPosNumber(d.ticketCostTokens))
        err.push(`[Drawing Games] Drawing ${i + 1}: ASH Cost must be a number`);
      if (!checkPosInt(d.ticketCostPoints))
        err.push(`[Drawing Games] Drawing ${i + 1}: PIXEL Cost must be an integer`);
      if (d.nfts.length == 0) err.push(`[Drawing Games] Drawing ${i + 1}: Must have at least one NFT`);
      for (const [j, n] of d.nfts.entries()) {
        if (!checkRequired(n.name)) err.push(`[Drawing Games] Drawing ${i + 1} NFT ${j + 1}: Name is required`);
        // if (!checkRequired(n.tags)) err.push(`[Drawing Games] Drawing ${i + 1} NFT ${j + 1}: NFT must have at least one tag`);
        if (!checkReqPosInt(n.numberOfEditions))
          err.push(`[Drawing Games] Drawing ${i + 1} NFT ${j + 1}: Editions must be an integer`);
        if (!checkRequired(n.description))
          err.push(`[Drawing Games] Drawing ${i + 1} NFT ${j + 1}: Description is required`);
      }
    }
  };

  validateTab1(data);
  // validateTab2(data);
  validateTab3(data);
  validateTab4(data);

  if (data.auctionGames.length == 0 && data.drawingGames.length == 0) err.push('Drop must have at least one game');

  return err;
}
