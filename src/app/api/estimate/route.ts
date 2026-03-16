import {
  estimateByOwnerAddress,
  estimateByOwnerAddresses,
} from '@/lib/estimate/estimateService';
import type { EstimateRequestBody } from '@/lib/estimate/types';
import { isAddress } from 'viem';
import { z } from 'zod';

const MAX_OWNER_ADDRESSES = 100;
const MAX_RUNWAY_DAYS = 3650;
const MAX_MANUAL_OPERATOR_OVERRIDES = 5000;

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
    if (entries.length > MAX_MANUAL_OPERATOR_OVERRIDES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `manualOperatorFeesWeiById supports at most ${MAX_MANUAL_OPERATOR_OVERRIDES} entries`,
      });
      return;
    }

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
  ownerAddress: z.string().min(1).optional(),
  ownerAddresses: z
    .array(z.string().min(1))
    .max(
      MAX_OWNER_ADDRESSES,
      `ownerAddresses supports at most ${MAX_OWNER_ADDRESSES} addresses`,
    )
    .optional(),
  runwayDays: z
    .number()
    .positive()
    .max(MAX_RUNWAY_DAYS, `runwayDays must be <= ${MAX_RUNWAY_DAYS}`),
  overrides: overrideSchema,
})
  .superRefine((value, ctx) => {
    const hasSingle = Boolean(value.ownerAddress && value.ownerAddress.trim());
    const hasMany = Array.isArray(value.ownerAddresses) && value.ownerAddresses.length > 0;

    if (!hasSingle && !hasMany) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide ownerAddress or ownerAddresses',
      });
    }

    if (hasSingle && hasMany) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either ownerAddress or ownerAddresses, not both',
      });
    }
  });

const validateBody = (body: EstimateRequestBody) => {
  const parsed = requestSchema.parse(body);

  const ownerAddressesRaw =
    parsed.ownerAddress && parsed.ownerAddress.trim().length > 0
      ? [parsed.ownerAddress]
      : (parsed.ownerAddresses ?? []);

  const ownerAddresses = [...new Set(ownerAddressesRaw.map((owner) => owner.trim().toLowerCase()))]
    .filter((owner) => owner.length > 0);

  if (ownerAddresses.length === 0) {
    throw new Error('At least one owner address is required');
  }

  const invalidOwners = ownerAddresses.filter((owner) => !isAddress(owner));
  if (invalidOwners.length > 0) {
    throw new Error(`Invalid owner address(es): ${invalidOwners.join(', ')}`);
  }

  if (
    parsed.overrides?.manualOperatorFeeOverrideEnabled === true &&
    ownerAddresses.length !== 1
  ) {
    throw new Error(
      'Manual operator fee override is available only for single-owner estimates',
    );
  }

  return {
    runwayDays: parsed.runwayDays,
    overrides: parsed.overrides,
    ownerAddresses,
  };
};

export async function POST(request: Request) {
  try {
    const json = (await request.json()) as EstimateRequestBody;
    const body = validateBody(json);

    const result =
      body.ownerAddresses.length === 1
        ? await estimateByOwnerAddress(
            body.ownerAddresses[0],
            body.runwayDays,
            body.overrides,
          )
        : await estimateByOwnerAddresses(
            body.ownerAddresses,
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

    const clientErrorHints = [
      'must be',
      'No clusters found',
      'No estimable clusters found',
      'not found',
      'required',
      'Invalid owner address',
      'single-owner estimates',
    ];

    const status =
      clientErrorHints.some((hint) => message.includes(hint)) ? 400 : 500;

    if (status === 500) {
      console.error('Estimate API internal error', error);
      return Response.json(
        {
          error:
            'Internal data source error while calculating estimate. Please retry in a moment.',
        },
        { status },
      );
    }

    return Response.json({ error: message }, { status });
  }
}
