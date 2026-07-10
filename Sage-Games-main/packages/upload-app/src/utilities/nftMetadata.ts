export function buildNftMetadata(name: string, description: string, mediaURL: string, isVideo: boolean): string {
  // TODO: metadata for video files should be different, check https://docs.opensea.io/docs/metadata-standards
  return JSON.stringify({
    name,
    description,
    image: mediaURL,
  });
}
