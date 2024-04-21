import Docker from 'dockerode';
import { promisify } from 'util';

import { ImageName } from './common';

// Use Dockerode to build the image
export default async function buildImage(docker: Docker): Promise<void> {
  const stream = await docker.buildImage(
    {
      context: __dirname,
      src: ['Dockerfile', 'yqrt'],
    },
    {
      t: ImageName,
    },
  );
  await promisify(docker.modem.followProgress.bind(docker.modem))(stream);
}
