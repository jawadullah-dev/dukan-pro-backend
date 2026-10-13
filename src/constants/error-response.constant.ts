import { Type } from '@nestjs/common';
import { ApiResponseOptions } from '@nestjs/swagger';
import { getSchemaPath } from '@nestjs/swagger';
import { HttpStatus } from '@nestjs/common';
import { ErrorResponseDTO } from '../common-dto/response/error-response.dto.js';
import { ApiSuccessResponseDTO } from '../common-dto/response/api-success-response.dto.js';
import { ERROR_DESCRIPTIONS } from './error-description.constant.js';

/**
 * The 4 canned ApiResponse() blocks used on EVERY controller endpoint,
 * in addition to the 200 success shape returned by OK_RESPONSE_STATUS(...).
 */
export const BAD_REQUEST_RESPONSE: ApiResponseOptions = {
  status: HttpStatus.BAD_REQUEST,
  description: ERROR_DESCRIPTIONS.BAD_REQUEST,
  type: ErrorResponseDTO,
};

export const UNAUTHORIZED_REQUEST_RESPONSE: ApiResponseOptions = {
  status: HttpStatus.UNAUTHORIZED,
  description: ERROR_DESCRIPTIONS.UNAUTHORIZED,
  type: ErrorResponseDTO,
};

export const FORBIDDEN_REQUEST_RESPONSE: ApiResponseOptions = {
  status: HttpStatus.FORBIDDEN,
  description: ERROR_DESCRIPTIONS.FORBIDDEN,
  type: ErrorResponseDTO,
};

export const NOT_FOUND_REQUEST_RESPONSE: ApiResponseOptions = {
  status: HttpStatus.NOT_FOUND,
  description: ERROR_DESCRIPTIONS.NOT_FOUND,
  type: ErrorResponseDTO,
};

export const INTERNAL_SERVER_ERROR_RESPONSE: ApiResponseOptions = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  description: ERROR_DESCRIPTIONS.INTERNAL_SERVER_ERROR,
  type: ErrorResponseDTO,
};

/**
 * Shorthand for @ApiSuccessResponseDecorator argument.
 * Produces a 200 response where the ApiSuccessResponseDTO.data field is of
 * type T, described with the passed human text.
 */
export const OK_RESPONSE_STATUS = <TModel extends Type<unknown>>(
  type: TModel,
  description: string,
) => {
  return {
    status: HttpStatus.OK,
    description,
    type,
    _extraModels: [ApiSuccessResponseDTO, type],
    _schemaOverride: {
      allOf: [
        { $ref: getSchemaPath(ApiSuccessResponseDTO) },
        {
          properties: {
            message: { type: 'string' },
            data: { $ref: getSchemaPath(type) },
          },
        },
      ],
    },
  };
};
