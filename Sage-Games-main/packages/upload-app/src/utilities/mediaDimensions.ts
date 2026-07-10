export type Dimensions = {
  width: number;
  height: number;
};

export async function getDimensions(file: File): Promise<Dimensions> {
  const objectURL = URL.createObjectURL(file);
  if (file.type == 'video/mp4') {
    return await getVideoDimensions(objectURL);
  }
  return await getImageDimensions(objectURL);
}

async function getVideoDimensions(data: string): Promise<Dimensions> {
  let video = document.createElement('video');
  let source = document.createElement('source');
  source.type = 'video/mp4';
  source.src = data;
  video.appendChild(source);
  while (video.videoWidth == 0) {
    await new Promise((r) => setTimeout(r, 250)); // give the browser a sec to process video
  }
  return <Dimensions>{ width: video.videoWidth, height: video.videoHeight };
}

async function getImageDimensions(dataUrl: string): Promise<Dimensions> {
  if (dataUrl.startsWith('data:image/svg+xml')) {
    return getSVGDimensions(dataUrl);
  }
  let img = document.createElement('img');
  img.src = dataUrl;
  while (img.width == 0) {
    await new Promise((r) => setTimeout(r, 250)); // give the browser a sec to process img
  }
  return <Dimensions>{ width: img.width, height: img.height };
}

function getSVGDimensions(dataUrl: string): Dimensions {
  try {
    let decodedSvgText = atob(dataUrl.replace('data:image/svg+xml;base64,', ''));
    decodedSvgText = decodedSvgText.substring(decodedSvgText.indexOf('<svg'));
    let div = document.createElement('div');
    div.innerHTML = decodedSvgText;
    let svg = div.firstChild as SVGElement;
    let viewbox = svg.getAttribute('viewBox').split(' ');
    return <Dimensions>{ width: Number(viewbox[2]), height: Number(viewbox[3]) };
  } catch (e) {
    console.log(e);
    return <Dimensions>{ width: 100, height: 100 };
  }
}
