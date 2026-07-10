import { NextApiRequest, NextApiResponse } from 'next';
import multer from 'multer';
import sharp from 'sharp';
import { uploadBufferToS3 } from '@/utilities/awsS3-server';
import NextCors from 'nextjs-cors';
import { OPTIMIZED_IMAGE_WIDTH } from '@/constants/config';

export const config = { api: { bodyParser: false } };

interface RequestWithFile extends NextApiRequest {
  file?: any;
}

const upload = multer({
  storage: multer.memoryStorage(),
  // limits: { fileSize: 1024 * 1024 },
});

async function handler(req: RequestWithFile, res: NextApiResponse) {
  await setupCors(req, res);
  try {
    await runMiddleware(req, res, upload.single('file'));
    const tiffBuffer: Buffer = Buffer.from(req.file.buffer);
    const jpegBuffer: Buffer = await sharp(tiffBuffer)
      .jpeg()
      .resize(OPTIMIZED_IMAGE_WIDTH)
      .toBuffer();
    const folder = 'optimized';
    const filename = `${Date.now().toString()}.jpg`;
    const s3PathOptimized = await uploadBufferToS3(folder, filename, 'image/jpeg', jpegBuffer);
    res.json({ s3PathOptimized });
  } catch (e: any) {
    console.log(e);
    res.json({ s3PathOptimized: null });
  }
}

const runMiddleware = (req: NextApiRequest, res: NextApiResponse, fn: any) => {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: unknown) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
};

async function setupCors(request: NextApiRequest, response: NextApiResponse) {
  await NextCors(request, response, {
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200,
  });
}

export default handler;
