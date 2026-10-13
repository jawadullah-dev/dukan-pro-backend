import { Prisma } from '../generated/prisma/client.js';
import {
  isUniqueConstraintViolation,
  uniqueViolationColumns,
  violatedColumn,
} from './prisma-error-helper.js';

function known(meta: unknown) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: meta as any,
  });
}

/** The shape Prisma 7 + @prisma/adapter-pg produces in this project. */
function adapterViolation(indexName: string) {
  return known({
    modelName: 'Product',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        kind: 'UniqueConstraintViolation',
        constraint: { index: indexName },
        table: 'products',
      },
    },
  });
}

describe('prisma-error-helper', () => {
  describe('isUniqueConstraintViolation', () => {
    it('accepts a P2002 known request error', () => {
      expect(
        isUniqueConstraintViolation(known({ target: ['shop_id', 'sku'] })),
      ).toBe(true);
      expect(
        isUniqueConstraintViolation(
          adapterViolation('products_shop_id_sku_key'),
        ),
      ).toBe(true);
    });

    it('rejects a plain error', () => {
      expect(isUniqueConstraintViolation(new Error('nope'))).toBe(false);
      expect(isUniqueConstraintViolation(undefined)).toBe(false);
    });
  });

  describe('uniqueViolationColumns', () => {
    it('reads the classic meta.target array', () => {
      expect(
        uniqueViolationColumns(known({ target: ['shop_id', 'SKU'] })),
      ).toEqual(['shop_id', 'sku']);
    });

    it('reads a bare meta.target string', () => {
      expect(uniqueViolationColumns(known({ target: 'sku' }))).toEqual(['sku']);
    });

    it('reads the driver-adapter constraint index when meta.target is absent', () => {
      const cols = uniqueViolationColumns(
        adapterViolation('products_shop_id_sku_key'),
      );
      expect(cols).toContain('sku');
      expect(cols).toContain('products_shop_id_sku');
    });

    it('returns an empty list for a non-P2002 error', () => {
      expect(uniqueViolationColumns(new Error('boom'))).toEqual([]);
    });

    it('returns an empty list when meta is missing entirely', () => {
      expect(uniqueViolationColumns(known(undefined))).toEqual([]);
    });
  });

  describe('violatedColumn', () => {
    it.each([
      ['products_shop_id_sku_key', 'sku', true],
      ['products_shop_id_sku_key', 'barcode', false],
      ['products_shop_id_barcode_key', 'barcode', true],
      ['products_shop_id_name_key', 'name', true],
      ['products_shop_id_name_key', 'sku', false],
    ])('%s vs %s -> %s', (index, column, expected) => {
      expect(violatedColumn(adapterViolation(index), column)).toBe(expected);
    });

    it('matches a classic meta.target entry', () => {
      expect(violatedColumn(known({ target: ['shop_id', 'sku'] }), 'sku')).toBe(
        true,
      );
      expect(
        violatedColumn(known({ target: ['shop_id', 'sku'] }), 'name'),
      ).toBe(false);
    });

    it('is false for errors that are not unique violations', () => {
      expect(violatedColumn(new Error('boom'), 'sku')).toBe(false);
    });
  });
});
