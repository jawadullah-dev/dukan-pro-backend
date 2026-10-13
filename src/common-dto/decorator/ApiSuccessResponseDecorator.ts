import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiSuccessResponseDTO } from '../response/api-success-response.dto.js';

interface ApiSuccessResponseDecoratorInput {
  status: number;
  description: string;
  type: Type<unknown>;
}

export const ApiSuccessResponseDecorator = ({
  status,
  description,
  type,
}: ApiSuccessResponseDecoratorInput) => {
  return applyDecorators(
    ApiExtraModels(ApiSuccessResponseDTO, type),
    ApiResponse({
      status,
      description,
      schema: {
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
    }),
  );
};
