// usage: standard string manipulation through entire site for 1) drop names 2) nft names 3) game names, 4) artist names throughout app
export function transformTitle(title: string) {
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Formats a timestamp to a MM/dd HH:mm string
 */
export function formatTimestampYYMMddHHmm(ts: number) {
  return formatDateYYMMddHHmm(new Date(ts * 1000));
}

export function formatDateYYMMddHHmm(date: Date) {
  const padTo2Dig = (v: number) => v.toString().padStart(2, '0');
  const d = new Date(date);
  return (
    `${d.getFullYear()}/${padTo2Dig(d.getMonth() + 1)}/${padTo2Dig(d.getDate())} ` +
    `${padTo2Dig(d.getHours())}:${padTo2Dig(d.getMinutes())}`
  );
}

/**
 * Returns a string without HTML tag characters.
 * @param htmlString input string containing HTML tag characters.
 * @returns output string stripped of HTML tag characters
 *
 */
export function parseHTMLStrings(htmlString: string) {
  const regex = /(<([^>]+)>)/gi;
  return htmlString.replace(regex, '');
}
