import sharp from 'sharp';
import { SAMPLE_SIZE } from './common';

export default async function download(url: string): Promise<Buffer> {
  // download
  const download = await fetch(url);
  const image = await download.arrayBuffer();
  // resize
  const data = await sharp(image)
    .greyscale()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
    .rotate()
    .raw()
    .toBuffer();
  return data;
}
