import {
  estimateByOwnerAddress,
} from '@/lib/estimate/estimateService';
import type { EstimateRequestBody } from '@/lib/estimate/types';
import { isAddress } from 'viem';
import { z } from 'zod';

const overrideSchema = z
  .object({
    networkFeeWei: z
      .string()
      .regex(/^\d+$/, 'networkFeeWei must be a non-negative integer')
      .optional(),
    minimumLiquidationCollateralWei: z
      .string()
      .regex(
        /^\d+$/,
        'minimumLiquidationCollateralWei must be a non-negative integer',
      )
      .optional(),
    liquidationThreshold: z
      .string()
      .regex(/^\d+$/, 'liquidationThreshold must be a non-negative integer')
      .optional(),
    manualOperatorFeeOverrideEnabled: z.boolean().optional(),
    manualOperatorFeesWeiById: z
      .record(
        z.string(),
        z.string().regex(
          /^\d+$/,
          'manual operator fee values must be non-negative integers',
        ),
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.manualOperatorFeeOverrideEnabled !== true) return;

    const entries = Object.entries(value.manualOperatorFeesWeiById ?? {});
    if (entries.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'manualOperatorFeesWeiById is required when manualOperatorFeeOverrideEnabled is true',
      });
    }
  })
  .optional();

const requestSchema = z.object({
  ownerAddress: z.string().min(1),
  runwayDays: z.number().positive(),
  overrides: overrideSchema,
});

const validateBody = (body: EstimateRequestBody) => {
  const parsed = requestSchema.parse(body);

  if (!isAddress(parsed.ownerAddress.trim())) {
    throw new Error('Owner address must be a valid EVM address');
  }

  return {
    ...parsed,
    ownerAddress: parsed.ownerAddress.trim(),
  };
};

export async function POST(request: Request) {
  try {
    const json = (await request.json()) as EstimateRequestBody;
    const body = validateBody(json);

    const result = await estimateByOwnerAddress(
      body.ownerAddress,
      body.runwayDays,
      body.overrides,
    );

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues.map((issue) => issue.message).join('; ') },
        { status: 400 },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error while calculating the estimate';

    const status =
      message.includes('must be') ||
      message.includes('No clusters found') ||
      message.includes('not found')
        ? 400
        : 500;

    return Response.json({ error: message }, { status });
  }
}
