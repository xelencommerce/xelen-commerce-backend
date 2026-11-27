import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
export const ApiSuccess = (model: Type, status = 200) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: getSchemaPath(model) },
          meta: {
            type: 'object',
            required: ['requestId'],
            properties: { requestId: { type: 'string' } },
          },
        },
      },
    }),
  );
