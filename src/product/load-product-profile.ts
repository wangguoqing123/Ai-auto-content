import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { productProfileSchema, type ProductProfile } from './product-profile.js';

export async function loadProductProfile(rootDir = process.cwd()): Promise<ProductProfile> {
  const filePath = path.join(rootDir, 'config', 'product.yaml');
  try {
    const contents = await readFile(filePath, 'utf8');
    return productProfileSchema.parse(parse(contents) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Product profile validation failed for config/product.yaml: ${message}`, { cause: error });
  }
}
