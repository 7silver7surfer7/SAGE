export function validateEmail(val: string | null | undefined): boolean {
  if (!val || val.trim().length == 0) {
    return true; // empty values are accepted
  }
  const re =
    /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return !!String(val).match(re);
}

export function validateTwitter(val: string | null | undefined): boolean {
  if (!val || val.trim().length == 0) {
    return true; // empty values are accepted
  }
  const re = /^([a-z0-9_]{1,15})$/i;
  return !!String(val).match(re);
}

export function validateInstagram(val: string | null | undefined): boolean {
  if (!val || val.trim().length == 0) {
    return true; // empty values are accepted
  }
  const re = /^[\w](?!.*?\.{2})[\w.]{1,28}[\w]$/;
  return !!String(val).match(re);
}

export function validateMedium(val: string | null | undefined): boolean {
  if (!val || val.trim().length == 0) {
    return true; // empty values are accepted
  }
  const re = /^([a-z0-9_.]{1,15})$/i;
  return !!String(val).match(re);
}

export function validateWebpage(val: string | null | undefined): boolean {
  if (!val || val.trim().length == 0) {
    return true; // empty values are accepted
  }
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    val = `http://${val}`;
  }
  const re =
    /^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,}))\.?)(?::\d{2,5})?(?:[/?#]\S*)?$/i;
  return !!String(val).match(re);
}
