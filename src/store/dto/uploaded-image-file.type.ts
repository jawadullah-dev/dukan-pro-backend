/**
 * Minimal shape of an uploaded image as delivered by multer's
 * `FileInterceptor`. Declared locally because this project restricts ambient
 * types (`tsconfig` `types: ["jest"]`), so `Express.Multer.File` is not in
 * scope — and the service only ever reads `buffer`.
 */
export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}
