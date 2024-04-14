import Docker from 'dockerode';

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
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err, res) =>
      err ? reject(err) : resolve(res),
    );
  });
}
